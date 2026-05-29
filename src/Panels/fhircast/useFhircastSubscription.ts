import { useState, useRef, useEffect, useCallback } from 'react';
import { DEFAULT_SECRET, DEFAULT_LEASE, WEBSOCKET_CHANNEL_TYPE } from './constants';
import { SubscriptionParams, SubscriptionMode } from './types';
import type { ReceivedEvent, WebSocketStatusValue } from './types';

interface SubscribeParams {
  hubUrl: string;
  wsUrl: string;
  topic: string;
  events: string[];
  secret?: string;
  lease?: number;
  /** The real server WebSocket URL for hub.channel.endpoint (before proxy rewrite). */
  serverWsUrl?: string;
}

function generateEndpointId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function postToHub(
  hubUrl: string,
  mode: string,
  topic: string,
  events: string[],
  wsUrl: string,
  endpointId: string,
  secret: string,
  lease: number
): Promise<Response> {
  const params = new URLSearchParams();
  params.set(SubscriptionParams.mode, mode);
  params.set(SubscriptionParams.topic, topic);
  params.set(SubscriptionParams.events, events.join(','));
  params.set(SubscriptionParams.secret, secret);
  params.set(SubscriptionParams.lease, String(lease));
  params.set(SubscriptionParams.channelType, WEBSOCKET_CHANNEL_TYPE);
  params.set(SubscriptionParams.channelEndpoint, `${wsUrl}/${endpointId}`);

  return fetch(hubUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
}

export function useFhircastSubscription() {
  const [wsStatus, setWsStatus] = useState<WebSocketStatusValue>('Closed');
  const [receivedEvents, setReceivedEvents] = useState<ReceivedEvent[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const paramsRef = useRef<SubscribeParams | null>(null);
  const endpointIdRef = useRef<string | null>(null);
  const unsubscribedRef = useRef<boolean>(false);
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup WebSocket and reconnect timer on unmount
  useEffect(() => {
    return () => {
      unsubscribedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  const subscribe = useCallback(async (params: SubscribeParams) => {
    const {
      hubUrl,
      wsUrl,
      topic,
      events,
      secret = DEFAULT_SECRET,
      lease = DEFAULT_LEASE,
      serverWsUrl,
    } = params;

    // Close any existing connection first
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const endpointId = generateEndpointId();
    endpointIdRef.current = endpointId;
    paramsRef.current = params;

    // 1. HTTP POST to hub
    // Use serverWsUrl for hub.channel.endpoint (what the hub sees after proxy),
    // but wsUrl for the actual WebSocket connection (through the proxy).
    const endpointWsUrl = serverWsUrl || wsUrl;
    const response = await postToHub(
      hubUrl,
      SubscriptionMode.subscribe,
      topic,
      events,
      endpointWsUrl,
      endpointId,
      secret,
      lease
    );

    if (!response.ok) {
      throw new Error(
        `Hub subscription failed: ${response.status} ${response.statusText}`
      );
    }

    // 2. Use the server-returned WebSocket endpoint URL (per FHIRcast spec §2-4)
    const responseBody = await response.json();
    const fullWsUrl = responseBody['hub.channel.endpoint'] || `${wsUrl}/${endpointId}`;

    setWsStatus('Opening');
    unsubscribedRef.current = false;
    reconnectAttemptsRef.current = 0;

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(fullWsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[FhirCast] WebSocket opened, waiting for bind...');
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);

          // Binding confirmation from hub (accept both legacy and spec-compliant formats)
          if (data.bound === true || data['hub.mode'] === 'subscribe') {
            console.log('[FhirCast] WebSocket bound');
            setWsStatus('Open');
            resolve();
            return;
          }

          // FHIRcast event — prepend for newest-first ordering
          const event: ReceivedEvent = {
            id: data.id || generateEndpointId(),
            timestamp: data.timestamp || new Date().toISOString(),
            event: data.event || data,
          };
          setReceivedEvents((prev) => [event, ...prev]);

          // Send event ACK per FHIRcast spec (within 10s to avoid SyncError)
          if (data.id && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ id: data.id, status: '200' }));
          }
        } catch (err) {
          console.warn('[FhirCast] Failed to parse WS message:', err);
        }
      };

      ws.onclose = (evt) => {
        console.log('[FhirCast] WebSocket closed, code:', evt.code, 'reason:', evt.reason);
        wsRef.current = null;

        // Attempt reconnection if the close was unexpected
        if (!unsubscribedRef.current && reconnectAttemptsRef.current < 3) {
          const attempt = ++reconnectAttemptsRef.current;
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
          console.log(`[FhirCast] Reconnecting in ${delay}ms (attempt ${attempt}/3)...`);
          setWsStatus('Opening');
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            if (unsubscribedRef.current) {
              return;
            }
            const reconnectWs = new WebSocket(fullWsUrl);
            wsRef.current = reconnectWs;

            reconnectWs.onopen = ws.onopen;
            reconnectWs.onmessage = ws.onmessage;
            reconnectWs.onclose = ws.onclose;
            reconnectWs.onerror = (err) => {
              console.error('[FhirCast] Reconnect WebSocket error:', err);
            };
          }, delay);
        } else {
          setWsStatus('Closed');
        }
      };

      ws.onerror = (err) => {
        console.error('[FhirCast] WebSocket error:', err);
        setWsStatus('Closed');
        wsRef.current = null;
        reject(new Error('WebSocket connection failed'));
      };
    });
  }, []);

  const unsubscribe = useCallback(async () => {
    const params = paramsRef.current;
    const endpointId = endpointIdRef.current;

    // Mark as intentionally unsubscribed to prevent reconnection
    unsubscribedRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setWsStatus('Closed');

    // POST unsubscribe to hub (best-effort)
    if (params && endpointId) {
      const {
        hubUrl,
        wsUrl,
        topic,
        events,
        secret = DEFAULT_SECRET,
        lease = DEFAULT_LEASE,
        serverWsUrl,
      } = params;

      const endpointWsUrl = serverWsUrl || wsUrl;
      try {
        await postToHub(
          hubUrl,
          SubscriptionMode.unsubscribe,
          topic,
          events,
          endpointWsUrl,
          endpointId,
          secret,
          lease
        );
      } catch (err) {
        console.warn('[FhirCast] Unsubscribe POST failed:', err);
      }
    }

    paramsRef.current = null;
    endpointIdRef.current = null;
  }, []);

  return { wsStatus, receivedEvents, subscribe, unsubscribe };
}
