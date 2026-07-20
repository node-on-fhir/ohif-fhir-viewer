import { EventType } from './types';

// Fallback hub/WebSocket URLs used only when no SMART `iss` is configured.
// When a launch is present, FhirCastPanel discovers the hub from the SMART token's `hub.url`,
// then the FHIR CapabilityStatement, then by probing /fhircast/STU3, /fhircast/STU2, root, /api/hub.
// Absolute URLs (no proxy) — the FHIRcast hub must accept the OHIF origin.
export const DEFAULT_HUB_URL = 'http://localhost:3200/api/hub';
export const DEFAULT_WS_URL = 'ws://localhost:3200/bind';
export const DEFAULT_TOPIC = 'DrXRay';
export const DEFAULT_SECRET = 'secret';
export const DEFAULT_LEASE = 999;
export const WEBSOCKET_CHANNEL_TYPE = 'websocket';

export const DEFAULT_SELECTED_EVENTS = [
  EventType.PatientOpen,
  EventType.PatientClose,
  EventType.ImagingStudyOpen,
  EventType.ImagingStudyClose,
  EventType.ImagingStudyUpdate,
  EventType.ImagingStudySelect,
  EventType.DiagnosticReportOpen,
  EventType.DiagnosticReportClose,
  EventType.DiagnosticReportUpdate,
  EventType.DiagnosticReportSelect,
];

export const EVENT_OPTIONS = Object.values(EventType).map((value) => ({
  value,
  label: value,
}));

export const DEFAULT_CONTEXT = [
  {
    key: 'patient',
    resource: {
      resourceType: 'Patient',
      id: 'ewUbXT9RWEbSj5wPEdgRaBw3',
      identifier: [
        {
          system: 'urn:oid:1.2.840.114350',
          value: '185444',
        },
        {
          system: 'urn:oid:1.2.840.114350.1.13.861.1.7.5.737384.27000',
          value: '2667',
        },
      ],
    },
  },
  {
    key: 'study',
    resource: {
      resourceType: 'ImagingStudy',
      id: '8i7tbu6fby5ftfbku6fniuf',
      uid: 'urn:oid:2.16.124.113543.6003.1154777499.30246.19789.3503430045',
      identifier: [
        {
          system: '7678',
          value: 'REMOVED',
        },
      ],
      patient: {
        reference: 'Patient/ewUbXT9RWEbSj5wPEdgRaBw3',
      },
    },
  },
];
