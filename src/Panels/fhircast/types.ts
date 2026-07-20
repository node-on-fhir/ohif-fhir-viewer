export const SubscriptionParams = {
  callback: 'hub.callback',
  mode: 'hub.mode',
  events: 'hub.events',
  secret: 'hub.secret',
  topic: 'hub.topic',
  lease: 'hub.lease_seconds',
  channelType: 'hub.channel.type',
  channelEndpoint: 'hub.channel.endpoint',
} as const;

export const SubscriptionMode = {
  subscribe: 'subscribe',
  unsubscribe: 'unsubscribe',
} as const;

// Event names use the FHIRcast 3.0.0 / STU3 convention: the FHIR resource type is capitalized
// (e.g. `Patient-open`, `ImagingStudy-open`), matching Medplum's eventsSupported list
// (server: packages/server/src/fhircast/routes.ts). System events stay lowercase.
export const EventType = {
  PatientOpen: 'Patient-open',
  PatientClose: 'Patient-close',
  ImagingStudyOpen: 'ImagingStudy-open',
  ImagingStudyClose: 'ImagingStudy-close',
  EncounterOpen: 'Encounter-open',
  EncounterClose: 'Encounter-close',
  DiagnosticReportOpen: 'DiagnosticReport-open',
  DiagnosticReportClose: 'DiagnosticReport-close',
  PatientUpdate: 'Patient-update',
  ImagingStudyUpdate: 'ImagingStudy-update',
  ImagingStudySelect: 'ImagingStudy-select',
  EncounterUpdate: 'Encounter-update',
  DiagnosticReportUpdate: 'DiagnosticReport-update',
  DiagnosticReportSelect: 'DiagnosticReport-select',
  SyncError: 'syncerror',
  LogoutUser: 'userlogout',
  HibernateUser: 'userhibernate',
} as const;

export type EventTypeValue = (typeof EventType)[keyof typeof EventType];

export const WebSocketStatus = {
  Closed: 'Closed',
  Opening: 'Opening',
  Open: 'Open',
} as const;

export type WebSocketStatusValue = (typeof WebSocketStatus)[keyof typeof WebSocketStatus];

export interface Subscription {
  topic: string;
  events: string[];
  status: 'active' | 'inactive';
}

export interface ReceivedEvent {
  id: string;
  timestamp: string;
  event: {
    'hub.topic'?: string;
    'hub.event'?: string;
    [key: string]: unknown;
  };
}
