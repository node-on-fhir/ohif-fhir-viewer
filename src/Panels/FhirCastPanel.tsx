import React, { useState, useEffect } from 'react';
import { useSystem } from '@ohif/core';
import { PanelSection } from '@ohif/ui-next';
import SubscribeForm from './fhircast/SubscribeForm';
import SubscriptionList from './fhircast/SubscriptionList';
import EventsList from './fhircast/EventsList';
import { DEFAULT_HUB_URL, DEFAULT_WS_URL, DEFAULT_TOPIC, DEFAULT_SELECTED_EVENTS } from './fhircast/constants';
import type { Subscription } from './fhircast/types';
import { useFhircastSubscription } from './fhircast/useFhircastSubscription';
import './fhircast/fhircast.css';
import { getFhirConfig, getImagingStudyStore } from '../FhirDataSource';

function FhirCastPanel() {
  const config = getFhirConfig();
  const { servicesManager } = useSystem();
  const { uiNotificationService } = servicesManager?.services || {};

  // Ordered hub-base candidates to probe when the SMART token didn't supply hub.url.
  // /api/hub first (Node on FHIR and the FHIRcast reference sandbox — also the fallback default
  // when discovery fails); Medplum mounts versioned hubs under /fhircast/STU3 (3.0.0) and
  // /fhircast/STU2; some hubs mount at the origin root.
  const buildCandidates = (iss: string): string[] => {
    try {
      const origin = new URL(iss).origin;
      return [`${origin}/api/hub`, `${origin}/fhircast/STU3`, `${origin}/fhircast/STU2`, origin];
    } catch {
      return [];
    }
  };

  // Derive a default WebSocket URL from a resolved hub base. The hub returns the definitive
  // endpoint in the subscribe response (hub.channel.endpoint), so this is only the displayed value.
  const deriveWsUrl = (hub: string): string => {
    try {
      const u = new URL(hub, window.location.origin);
      const wsProtocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      const path = u.pathname.includes('/fhircast/') ? '/ws/fhircast' : '/bind';
      return `${wsProtocol}//${u.host}${path}`;
    } catch {
      return DEFAULT_WS_URL;
    }
  };

  // Best synchronous guess (refined asynchronously by discovery below): prefer the SMART token's
  // hub.url, else the first probe candidate, else the static default.
  const tokenHubUrl = config.hubUrl || '';
  const initialHubUrl = tokenHubUrl || buildCandidates(config.iss)[0] || DEFAULT_HUB_URL;
  const initialWsUrl = deriveWsUrl(initialHubUrl);

  // Prefer the FHIRcast session topic from the SMART launch, else the patient id.
  const initialTopic = config.hubTopic || config.patientId || DEFAULT_TOPIC;

  // Form state
  const [hubUrl, setHubUrl] = useState(initialHubUrl);
  const [wsUrl, setWsUrl] = useState(initialWsUrl);
  const [topic, setTopic] = useState(initialTopic);
  const [selectedEvents, setSelectedEvents] = useState<string[]>([...DEFAULT_SELECTED_EVENTS]);
  const [saveToClient, setSaveToClient] = useState(true);
  const [saveToServer, setSaveToServer] = useState(false);

  // Subscription hook (HTTP + WebSocket)
  const { wsStatus, receivedEvents, subscribe, unsubscribe } = useFhircastSubscription();
  const [subscriptions, setSubscriptions] = useState<Record<string, Subscription>>({});

  // ImagingStudy context state
  const [imagingStudyStatus, setImagingStudyStatus] = useState<string>('unknown');
  const [imagingStudyId, setImagingStudyId] = useState<string>('');

  // Discover the FHIRcast hub on mount: SMART token hub.url → FHIR CapabilityStatement extension →
  // probe versioned/legacy candidates by their .well-known document. First match wins and updates
  // the hub/WS fields. Depends on iss + token hub.url (not hubUrl) to avoid a set-state loop.
  useEffect(() => {
    let cancelled = false;

    const fetchWellKnown = async (base: string) => {
      const res = await fetch(`${base}/.well-known/fhircast-configuration`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    };

    // Read hub.url from the FHIR server's CapabilityStatement fhircast-configuration-extension.
    const fetchCapabilityHubUrl = async (): Promise<string | null> => {
      if (!config.iss) return null;
      try {
        const metadataUrl = new URL('metadata', config.iss).toString();
        const res = await fetch(metadataUrl, { headers: { Accept: 'application/fhir+json' } });
        if (!res.ok) return null;
        const cap = await res.json();
        for (const rest of Array.isArray(cap?.rest) ? cap.rest : []) {
          for (const ext of rest?.extension || []) {
            if (typeof ext?.url === 'string' && ext.url.includes('fhircast-configuration-extension')) {
              for (const sub of ext.extension || []) {
                if (sub?.url === 'hub.url' && sub?.valueUrl) {
                  return sub.valueUrl as string;
                }
              }
            }
          }
        }
      } catch {
        // ignore — fall back to probing
      }
      return null;
    };

    const applyHub = (base: string, caps: unknown, how: string) => {
      if (cancelled) return;
      console.log(`[FhirCast] Hub discovered (${how}):`, base, caps);
      setHubUrl(base);
      setWsUrl(deriveWsUrl(base));
    };

    const discover = async () => {
      // 1. Token-provided hub.url — trust it even if a cross-origin probe is blocked.
      if (tokenHubUrl) {
        try {
          const caps = await fetchWellKnown(tokenHubUrl);
          applyHub(tokenHubUrl, caps, 'token hub.url');
        } catch (err) {
          if (!cancelled) {
            console.warn('[FhirCast] token hub.url well-known check failed, using it anyway:', err);
            setHubUrl(tokenHubUrl);
            setWsUrl(deriveWsUrl(tokenHubUrl));
          }
        }
        return;
      }

      // 2. CapabilityStatement extension.
      const capHubUrl = await fetchCapabilityHubUrl();
      if (capHubUrl) {
        try {
          const caps = await fetchWellKnown(capHubUrl);
          applyHub(capHubUrl, caps, 'CapabilityStatement');
          return;
        } catch {
          // fall through to probing
        }
      }

      // 3. Probe candidates; first whose well-known returns 200 wins.
      for (const candidate of buildCandidates(config.iss)) {
        if (cancelled) return;
        try {
          const caps = await fetchWellKnown(candidate);
          applyHub(candidate, caps, 'probe');
          return;
        } catch {
          // try next candidate
        }
      }

      if (!cancelled) {
        console.warn('[FhirCast] Hub discovery failed; using default:', initialHubUrl);
      }
    };

    discover();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.iss, tokenHubUrl]);

  // Read initial ImagingStudy status from the store on mount
  useEffect(() => {
    const studyMap = getImagingStudyStore();
    if (studyMap && studyMap.size > 0) {
      const firstStudy = studyMap.values().next().value;
      if (firstStudy) {
        setImagingStudyId(firstStudy.id || '');
        setImagingStudyStatus(firstStudy.status || 'unknown');
      }
    }
  }, []);

  // Watch receivedEvents for ImagingStudy context updates
  useEffect(() => {
    if (receivedEvents.length === 0) return;
    const latest = receivedEvents[0];
    const evt = latest?.event;
    if (!evt) return;

    const contexts = evt['context'] || evt?.context;
    if (!Array.isArray(contexts)) return;

    for (const ctx of contexts) {
      if (ctx.key === 'study' && ctx.resource?.resourceType === 'ImagingStudy') {
        const study = ctx.resource;
        if (study.status) setImagingStudyStatus(study.status);
        if (study.id) setImagingStudyId(study.id);
        break;
      }
    }
  }, [receivedEvents]);

  const hasSubscriptions = Object.keys(subscriptions).length > 0;
  const [subscribeError, setSubscribeError] = useState('');

  // Translate raw fetch/HTTP errors into something actionable for the panel.
  const describeSubscribeError = (err: unknown): string => {
    const message = err instanceof Error ? err.message : String(err);
    if (/\b(404|405)\b/.test(message)) {
      return `No FHIRcast hub answered at ${hubUrl}. Check the Hub URL — NodeOnFHIR hubs listen at /api/hub.`;
    }
    if (err instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(message)) {
      return `Could not reach ${hubUrl} from ${window.location.origin}. The hub may be down or blocking this origin via CORS.`;
    }
    return message;
  };

  const showSubscribeError = (err: unknown, action: string) => {
    console.error(`[FhirCastPanel] ${action} failed:`, err);
    const message = describeSubscribeError(err);
    setSubscribeError(message);
    uiNotificationService?.show({
      title: `FHIRcast ${action} Failed`,
      message,
      type: 'error',
      duration: 10000,
    });
  };

  const handleSubscribe = async () => {
    setSubscribeError('');
    try {
      await subscribe({ hubUrl, wsUrl, topic, events: selectedEvents, authToken: config.authToken || undefined });
      setSubscriptions((prev) => ({
        ...prev,
        [topic]: { topic, events: [...selectedEvents], status: 'active' },
      }));
    } catch (err) {
      showSubscribeError(err, 'Subscribe');
    }
  };

  const handleUnsubscribe = async () => {
    setSubscribeError('');
    try {
      await unsubscribe();
    } catch (err) {
      showSubscribeError(err, 'Unsubscribe');
    }
    setSubscriptions((prev) => {
      const next = { ...prev };
      delete next[topic];
      return next;
    });
  };

  const handleUnsubscribeSub = (sub: Subscription) => {
    unsubscribe();
    setSubscriptions((prev) => {
      const next = { ...prev };
      delete next[sub.topic];
      return next;
    });
  };

  return (
    <div className="ohif-scrollbar fhircast-panel-scroll flex select-none flex-col">
      <PanelSection defaultOpen={true}>
        <PanelSection.Header>Study Context</PanelSection.Header>
        <PanelSection.Content className="bg-muted space-y-2 px-4 pt-2 pb-4">
          <div className="space-y-1.5">
            <div className="text-muted-foreground text-xs">ImagingStudy ID</div>
            <div className="rounded border border-white/10 bg-black/30 px-2 py-1.5">
              <span className="font-mono text-xs text-white">
                {imagingStudyId || 'N/A'}
              </span>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-muted-foreground text-xs">Status</div>
            <div>
              <span
                className={`fhircast-status-badge ${
                  imagingStudyStatus === 'available' || imagingStudyStatus === 'reported'
                    ? 'fhircast-status-badge--good'
                    : imagingStudyStatus === 'registered' || imagingStudyStatus === 'unread'
                      ? 'fhircast-status-badge--pending'
                      : imagingStudyStatus === 'unknown'
                        ? 'fhircast-status-badge--unknown'
                        : 'fhircast-status-badge--other'
                }`}
              >
                {imagingStudyStatus}
              </span>
            </div>
          </div>
        </PanelSection.Content>
      </PanelSection>

      <PanelSection defaultOpen={true}>
        <PanelSection.Header>Subscribe to Events</PanelSection.Header>
        <PanelSection.Content className="bg-muted space-y-2 px-4 pt-2 pb-4">
          <SubscribeForm
            hubUrl={hubUrl}
            onHubUrlChange={setHubUrl}
            wsUrl={wsUrl}
            onWsUrlChange={setWsUrl}
            wsStatus={wsStatus}
            topic={topic}
            onTopicChange={setTopic}
            selectedEvents={selectedEvents}
            onSelectedEventsChange={setSelectedEvents}
            saveToClient={saveToClient}
            onSaveToClientChange={setSaveToClient}
            saveToServer={saveToServer}
            onSaveToServerChange={setSaveToServer}
            hasSubscriptions={hasSubscriptions}
            onSubscribe={handleSubscribe}
            onUnsubscribe={handleUnsubscribe}
            subscribeError={subscribeError}
          />
        </PanelSection.Content>
      </PanelSection>

      <PanelSection defaultOpen={true}>
        <PanelSection.Header>Subscriptions</PanelSection.Header>
        <PanelSection.Content className="bg-muted px-4 pt-2 pb-4">
          <SubscriptionList
            subscriptions={subscriptions}
            onUnsubscribe={handleUnsubscribeSub}
          />
        </PanelSection.Content>
      </PanelSection>

      <PanelSection defaultOpen={true}>
        <PanelSection.Header>Received Events</PanelSection.Header>
        <PanelSection.Content className="bg-muted px-4 pt-2 pb-4">
          <EventsList events={receivedEvents} />
        </PanelSection.Content>
      </PanelSection>
    </div>
  );
}

export default FhirCastPanel;
