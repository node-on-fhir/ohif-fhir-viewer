import React, { useState, useEffect } from 'react';
import { PanelSection } from '@ohif/ui-next';
import SubscribeForm from './fhircast/SubscribeForm';
import SubscriptionList from './fhircast/SubscriptionList';
import EventsList from './fhircast/EventsList';
import { DEFAULT_HUB_URL, DEFAULT_WS_URL, DEFAULT_TOPIC, DEFAULT_SELECTED_EVENTS } from './fhircast/constants';
import type { Subscription } from './fhircast/types';
import { useFhircastSubscription } from './fhircast/useFhircastSubscription';
import { getFhirConfig, getImagingStudyStore } from '../FhirDataSource';

function FhirCastPanel() {
  const config = getFhirConfig();

  // Derive Hub URL and WebSocket URL from ISS origin
  let initialHubUrl = DEFAULT_HUB_URL;
  let initialWsUrl = DEFAULT_WS_URL;
  if (config.iss) {
    try {
      const issUrl = new URL(config.iss);
      console.log('[FhirCastPanel] Deriving FHIRcast URLs from ISS:', config.iss, 'port:', issUrl.port || '(default)');
      initialHubUrl = `${issUrl.origin}/api/hub`;
      const wsProtocol = issUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      initialWsUrl = `${wsProtocol}//${issUrl.host}/bind`;
    } catch (e) {
      // malformed ISS, keep defaults
    }
  }

  // Use PATIENT ID as Topic
  const initialTopic = config.patientId || DEFAULT_TOPIC;

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

  // Auto-discover hub capabilities on mount
  useEffect(() => {
    // Try hub-relative path first (Medplum mounts it as a sub-route of the hub router),
    // then fall back to origin-relative path (Node on FHIR serves it at the server root).
    const hubWellKnown = `${hubUrl}/.well-known/fhircast-configuration`;
    const originWellKnown = (() => {
      try {
        const u = new URL(hubUrl, window.location.origin);
        return `${u.origin}/.well-known/fhircast-configuration`;
      } catch {
        return null;
      }
    })();

    let cancelled = false;

    fetch(hubWellKnown)
      .then(res => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then(config => {
        if (!cancelled) {
          console.log('[FhirCast] Hub capabilities discovered:', config);
        }
      })
      .catch(() => {
        // Try origin-relative path as fallback
        if (cancelled || !originWellKnown || originWellKnown === hubWellKnown) return;
        fetch(originWellKnown)
          .then(res => {
            if (!res.ok) throw new Error(`${res.status}`);
            return res.json();
          })
          .then(config => {
            if (!cancelled) {
              console.log('[FhirCast] Hub capabilities discovered (origin):', config);
            }
          })
          .catch(err => {
            if (!cancelled) {
              console.warn('[FhirCast] Hub discovery failed (will use defaults):', err.message);
            }
          });
      });

    return () => { cancelled = true; };
  }, [hubUrl]);

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

  const handleSubscribe = async () => {
    try {
      await subscribe({ hubUrl, wsUrl, topic, events: selectedEvents });
      setSubscriptions((prev) => ({
        ...prev,
        [topic]: { topic, events: [...selectedEvents], status: 'active' },
      }));
    } catch (err) {
      console.error('[FhirCastPanel] Subscribe failed:', err);
    }
  };

  const handleUnsubscribe = () => {
    unsubscribe();
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
    <div className="flex select-none flex-col">
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
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                  imagingStudyStatus === 'available' || imagingStudyStatus === 'reported'
                    ? 'bg-green-600/20 text-green-400'
                    : imagingStudyStatus === 'registered' || imagingStudyStatus === 'unread'
                      ? 'bg-yellow-600/20 text-yellow-400'
                      : imagingStudyStatus === 'unknown'
                        ? 'bg-white/10 text-white/50'
                        : 'bg-blue-600/20 text-blue-400'
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
