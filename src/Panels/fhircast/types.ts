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

export const EventType = {
  PatientOpen: 'patient-open',
  PatientClose: 'patient-close',
  ImagingStudyOpen: 'imagingstudy-open',
  ImagingStudyClose: 'imagingstudy-close',
  EncounterOpen: 'encounter-open',
  EncounterClose: 'encounter-close',
  DiagnosticReportOpen: 'diagnosticreport-open',
  DiagnosticReportClose: 'diagnosticreport-close',
  PatientUpdate: 'patient-update',
  ImagingStudyUpdate: 'imagingstudy-update',
  EncounterUpdate: 'encounter-update',
  DiagnosticReportUpdate: 'diagnosticreport-update',
  DiagnosticReportSelect: 'diagnosticreport-select',
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
