import { DicomMetadataStore, IWebApiDataSource } from '@ohif/core';
import OHIF from '@ohif/core';

import dcmjs from 'dcmjs';
import {
  fetchPatient,
  fetchImagingStudies,
  fetchImagingStudyById,
  fetchDocumentReferences,
  fetchDicomFile,
  createDocumentReference,
} from './fhirClient';
import { imagingStudyToStudySummary, extractSeriesMetadata } from './fhirToOhif';
import { loadDicomFromAttachment, parseDicomArrayBuffer } from './dicomLoader';
import {
  fetchSmartConfiguration,
  generatePKCE,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  saveAuthState,
  loadAuthState,
  clearAuthState,
  saveToken,
  getStoredToken,
  registerSmartClient,
} from './smartAuth';

const metadataProvider = OHIF.classes.MetadataProvider;

const PLACEHOLDER_STUDY_UID = '__fhir_pending__';

let _config = {
  // Absolute FHIR URLs — the browser calls the FHIR server directly (CORS),
  // so the server must allow the OHIF origin. These are dev fallbacks; a
  // deployment overrides them via the data-source `configuration` in
  // window.config, and a SMART launch overrides them again from the `iss` param.
  fhirBaseUrl: 'http://localhost:3200/baseR4',
  fhirServerRoot: 'http://localhost:3200',
  patientId: '',
  authToken: '',
  iss: '',
  launch: '',
  urlParams: {},
  smartClientId: '',
  smartScope: '',
  smartAuthenticated: false,
};

let _store = {
  studies: [],
  studyInstanceUIDs: [],
  studyToFhirId: new Map(),
  imagingStudyMap: new Map(),
  loadedStudies: new Set(),
};

let _servicesManager = null;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function wrapSequences(obj) {
  return Object.keys(obj).reduce(
    (acc, key) => {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        acc[key] = wrapSequences(obj[key]);
      } else {
        acc[key] = obj[key];
      }
      if (key.endsWith('Sequence')) {
        acc[key] = OHIF.utils.addAccessors(acc[key]);
      }
      return acc;
    },
    Array.isArray(obj) ? [] : {}
  );
}

export function updateFhirConfig(newConfig) {
  Object.assign(_config, newConfig);
}

export function getFhirConfig() {
  return { ..._config };
}

export function getImagingStudyStore() {
  return _store.imagingStudyMap;
}

function base64Random() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  let str = '';
  for (const byte of array) {
    str += String.fromCharCode(byte);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function _fetchStudyUIDs(patientId) {
  try {
    const studyBundle = await fetchImagingStudies(_config.fhirBaseUrl, patientId, {
      authToken: _config.authToken,
    });

    const entries = studyBundle.entry || [];
    const studies = entries
      .map(e => e.resource)
      .filter(r => r && r.resourceType === 'ImagingStudy');

    if (studies.length !== entries.length) {
      console.log('[FHIR] _fetchStudyUIDs — filtered', entries.length, 'entries to', studies.length, 'ImagingStudy resources');
    }
    const studyUIDs = studies.map(s => {
      const summary = imagingStudyToStudySummary(s, '');
      _store.studyToFhirId.set(summary.studyInstanceUid, s.id);
      _store.imagingStudyMap.set(summary.studyInstanceUid, s);
      return summary.studyInstanceUid;
    });

    // Pre-register all discovered studies in DicomMetadataStore.
    // This ensures getStudiesFromUIDs() never returns undefined entries,
    // preventing HangingProtocolService._matchImages crashes.
    for (const s of studies) {
      const summary = imagingStudyToStudySummary(s, '');
      if (summary.StudyInstanceUID) {
        DicomMetadataStore.addStudy({
          StudyInstanceUID: summary.StudyInstanceUID,
          PatientID: summary.PatientID || '',
          PatientName: summary.PatientName || '',
          StudyDate: summary.StudyDate || '',
          ModalitiesInStudy: summary.Modalities ? summary.Modalities.split('\\') : [],
          StudyDescription: summary.StudyDescription || '',
          AccessionNumber: summary.AccessionNumber || '',
          NumInstances: summary.NumInstances || 0,
        });
        console.log('[FHIR] Pre-registered study in DicomMetadataStore:', summary.StudyInstanceUID);
      }
    }

    const validStudyUIDs = studyUIDs.filter(uid => uid && uid.length > 0);
    if (validStudyUIDs.length !== studyUIDs.length) {
      console.warn('[FHIR] _fetchStudyUIDs — filtered out', studyUIDs.length - validStudyUIDs.length, 'empty UIDs from', studyUIDs.length, 'total');
    }
    _store.studyInstanceUIDs = validStudyUIDs.length > 0 ? validStudyUIDs : [PLACEHOLDER_STUDY_UID];
    return _store.studyInstanceUIDs;
  } catch (error) {
    console.error('[FHIR] Failed to fetch studies:', error);
    _showFhirError(_servicesManager, error);
    _store.studyInstanceUIDs = [PLACEHOLDER_STUDY_UID];
    return [PLACEHOLDER_STUDY_UID];
  }
}

function _showFhirError(servicesManager, error) {
  const { uiNotificationService } = servicesManager?.services || {};
  if (!uiNotificationService) return;

  // Try to extract the JSON message from the error string
  // Error format: "FHIR request failed: 501 {"message":"..."}"
  let userMessage = error.message || String(error);
  try {
    const jsonMatch = userMessage.match(/\{.*\}/s);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.message) {
        userMessage = parsed.message;
      }
    }
  } catch (e) {
    // Use the raw error message if JSON parsing fails
  }

  uiNotificationService.show({
    title: 'FHIR Server Error',
    message: userMessage,
    type: 'error',
    duration: 10000,
  });
}

// Resolve the SMART client ID from the browser-native config surfaces, in
// most-specific-wins order:
//   1. URL `?client_id=`        — per-launch (a launch URL can carry it so one
//                                  deployment can face multiple registrations)
//   2. localStorage             — per-user, set via the SMART Preferences panel
//   3. window.config            — per-deployment, the data-source `configuration`
//                                  already merged into `_config` at registration
// There is no build-time env var: OHIF is a static SPA, so config must arrive at
// runtime through one of these surfaces.
function resolveSmartClientId(query) {
  const fromUrl = query && query.get && query.get('client_id');
  if (fromUrl) return fromUrl;
  try {
    const saved = JSON.parse(localStorage.getItem('fhir_smart_config') || '{}');
    if (saved.smartClientId) return saved.smartClientId;
  } catch (e) {
    /* ignore parse errors */
  }
  return _config.smartClientId || '';
}

function createFhirApi(fhirConfig, servicesManager) {
  _servicesManager = servicesManager;
  if (fhirConfig) {
    Object.assign(_config, fhirConfig);
  }

  // Client ID resolves from the data-source `configuration` merged above
  // (e.g. `smartClientId` in the OHIF data source config). localStorage —
  // populated by the SMART Preferences panel — overrides it when present.
  let clientIdSource = _config.smartClientId ? 'dataSourceConfig' : 'none';

  const savedSmartConfig = localStorage.getItem('fhir_smart_config');
  if (savedSmartConfig) {
    try {
      const parsed = JSON.parse(savedSmartConfig);
      if (parsed.smartClientId) {
        _config.smartClientId = parsed.smartClientId;
        clientIdSource = 'localStorage';
      }
      if (parsed.smartScope) _config.smartScope = parsed.smartScope;
      if (parsed.fhirBaseUrl) _config.fhirBaseUrl = parsed.fhirBaseUrl;
    } catch (e) { /* ignore parse errors */ }
  }

  if (!_config.smartClientId) {
    console.warn(
      '[FHIR] No SMART client ID configured. SMART on FHIR authentication ' +
        'requires `smartClientId` in the data-source configuration, or a value ' +
        'set via the SMART Preferences panel.'
    );
  }

  console.log('[FHIR] Data source initialized with config:', {
    fhirBaseUrl: _config.fhirBaseUrl,
    smartClientId: _config.smartClientId || '(not set)',
    smartScope: _config.smartScope || '(default)',
    source: clientIdSource,
  });

  const implementation = {
    initialize: async ({ params, query }) => {
      // Capture all URL query params for display in the sidebar
      if (query && query.entries) {
        const allParams = {};
        for (const [key, value] of query.entries()) {
          allParams[key] = value;
        }
        _config.urlParams = allParams;
      }

      const qGet = (key) => query && query.get && query.get(key);
      const code = qGet('code');
      const state = qGet('state');
      const iss = qGet('iss');
      const launch = qGet('launch');

      // ── CASE A: OAuth callback — exchange code for token ──
      if (code && state) {
        console.log('[FHIR] OAuth callback detected, exchanging code for token...');
        const authState = loadAuthState();

        if (!authState || authState.state !== state) {
          console.error('[FHIR] OAuth state mismatch or missing auth state');
          clearAuthState();
          _store.studyInstanceUIDs = [PLACEHOLDER_STUDY_UID];
          return [PLACEHOLDER_STUDY_UID];
        }

        try {
          const redirectUri = window.location.origin + window.location.pathname;
          const tokenResponse = await exchangeCodeForToken({
            tokenEndpoint: authState.tokenEndpoint,
            code,
            clientId: authState.clientId,
            redirectUri,
            codeVerifier: authState.codeVerifier,
          });

          saveToken(tokenResponse);
          clearAuthState();

          _config.authToken = tokenResponse.access_token;
          _config.iss = authState.iss;
          _config.fhirBaseUrl = authState.iss;
          _config.smartAuthenticated = true;

          try {
            const url = new URL(authState.iss);
            _config.fhirServerRoot = url.origin;
          } catch (e) {
            console.warn('[FHIR] Could not parse ISS URL:', e);
          }

          // Use patient from token response or saved state
          const patientId = tokenResponse.patient || authState.patientId || '';
          _config.patientId = patientId;
          _config.launch = authState.launch || '';

          // Restore original URL params saved before the OAuth redirect
          _config.urlParams = authState.urlParams || {};

          // Clean the URL — remove code/state params
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('code');
          cleanUrl.searchParams.delete('state');
          window.history.replaceState({}, '', cleanUrl.toString());

          if (!patientId) {
            console.warn('[FHIR] Authenticated but no patient ID. Use the FHIR Config panel.');
            _store.studyInstanceUIDs = [PLACEHOLDER_STUDY_UID];
            return [PLACEHOLDER_STUDY_UID];
          }

          return await _fetchStudyUIDs(patientId);
        } catch (error) {
          console.error('[FHIR] Token exchange failed:', error);
          clearAuthState();
          _store.studyInstanceUIDs = [PLACEHOLDER_STUDY_UID];
          return [PLACEHOLDER_STUDY_UID];
        }
      }

      // ── CASE B: EHR launch — discover endpoints & redirect to authorize ──
      if (iss && launch) {
        console.log('[FHIR] SMART EHR launch detected, starting OAuth flow...');
        const clientId = resolveSmartClientId(query);
        if (!clientId) {
          console.error('[FHIR] No smartClientId configured — cannot start OAuth flow');
          const { uiNotificationService } = _servicesManager?.services || {};
          if (uiNotificationService) {
            uiNotificationService.show({
              title: 'SMART on FHIR',
              message:
                'No SMART client ID configured. Set `smartClientId` in the data-source configuration, or via the SMART Preferences panel.',
              type: 'error',
              duration: 15000,
            });
          }
          _store.studyInstanceUIDs = [PLACEHOLDER_STUDY_UID];
          return [PLACEHOLDER_STUDY_UID];
        }
        const scope = _config.smartScope || 'launch openid fhirUser patient/*.read';
        const patientId = qGet('patient') || qGet('patientId') || _config.patientId;

        try {
          const endpoints = await fetchSmartConfiguration(iss);
          const { codeVerifier, codeChallenge } = await generatePKCE();
          const stateValue = base64Random();
          const redirectUri = window.location.origin + window.location.pathname;

          saveAuthState({
            state: stateValue,
            codeVerifier,
            iss,
            launch,
            patientId,
            clientId,
            tokenEndpoint: endpoints.token_endpoint,
            urlParams: _config.urlParams,
          });

          const authorizeUrl = buildAuthorizationUrl({
            authorizationEndpoint: endpoints.authorization_endpoint,
            clientId,
            redirectUri,
            scope,
            state: stateValue,
            codeChallenge,
            iss,
            launch,
          });

          console.log('[FHIR] Redirecting to authorization endpoint...');
          window.location.href = authorizeUrl;

          // Return placeholder — page will redirect before rendering
          _store.studyInstanceUIDs = [PLACEHOLDER_STUDY_UID];
          return [PLACEHOLDER_STUDY_UID];
        } catch (error) {
          console.error('[FHIR] SMART discovery failed:', error);
          // Fall through to manual config
        }
      }

      // ── CASE C: No OAuth params — check cached token or use manual config ──

      // Capture SMART launch params from URL (non-OAuth scenario)
      if (iss) {
        _config.iss = iss;
        _config.fhirBaseUrl = iss;
        try {
          const url = new URL(iss);
          _config.fhirServerRoot = url.origin;
        } catch (e) {
          console.warn('[FHIR] Could not parse ISS URL:', e);
        }
      }
      if (launch) {
        _config.launch = launch;
      }

      // Check for cached OAuth token
      if (!_config.authToken) {
        const cached = getStoredToken();
        if (cached) {
          _config.authToken = cached.access_token;
          _config.smartAuthenticated = true;
          console.log('[FHIR] Using cached OAuth token');
        }
      }

      const patientId = qGet('patient') || qGet('patientId') || _config.patientId;

      if (!patientId) {
        console.warn('[FHIR] No patientId configured. Use the FHIR Config panel to set one.');
        _store.studyInstanceUIDs = [PLACEHOLDER_STUDY_UID];
        return [PLACEHOLDER_STUDY_UID];
      }

      _config.patientId = patientId;
      return await _fetchStudyUIDs(patientId);
    },

    query: {
      studies: {
        mapParams: () => {},
        search: async (param) => {
          // Return a stub for the placeholder so the study browser doesn't
          // redirect to /notfoundstudy when no real studies are loaded yet.
          const requestedUid = param?.studyInstanceUid || param?.studyInstanceUID;
          if (requestedUid === PLACEHOLDER_STUDY_UID) {
            return [{
              StudyInstanceUID: PLACEHOLDER_STUDY_UID,
              studyInstanceUid: PLACEHOLDER_STUDY_UID,
              StudyDate: '',
              StudyDescription: 'Awaiting FHIR context...',
              ModalitiesInStudy: '',
              NumInstances: 0,
              PatientName: '',
              PatientID: '',
              AccessionNumber: '',
            }];
          }

          const patientId = _config.patientId;
          if (!patientId) return [];

          const opts = { authToken: _config.authToken };

          let patientName = '';
          try {
            const patient = await fetchPatient(_config.fhirBaseUrl, patientId, opts);
            if (patient.name && patient.name.length > 0) {
              const name = patient.name[0];
              const given = (name.given || []).join(' ');
              const family = name.family || '';
              patientName = `${family}^${given}`.trim();
            }
          } catch (error) {
            console.warn('[FHIR] Could not fetch patient name:', error);
          }

          try {
            const studyBundle = await fetchImagingStudies(_config.fhirBaseUrl, patientId, opts);
            const entries = studyBundle.entry || [];
            const studies = entries.map(e => e.resource);

            _store.studies = studies.map(s => {
              const summary = imagingStudyToStudySummary(s, patientName);
              _store.studyToFhirId.set(summary.studyInstanceUid, s.id);
              _store.imagingStudyMap.set(summary.studyInstanceUid, s);
              return summary;
            });

            _store.studyInstanceUIDs = _store.studies.map(s => s.studyInstanceUid);

            return _store.studies;
          } catch (error) {
            console.error('[FHIR] Failed to search studies:', error);
            return [];
          }
        },
        processResults: () => {
          console.warn('[FHIR] processResults not implemented');
        },
      },
      series: {
        search: () => {
          console.warn('[FHIR] series search not implemented');
        },
      },
      instances: {
        search: () => {
          console.warn('[FHIR] instances search not implemented');
        },
      },
    },

    retrieve: {
      directURL: params => {
        return params?.instance?.url || params?.tag;
      },
      series: {
        metadata: async ({
          filters = {},
          StudyInstanceUID,
          madeInClient = false,
        } = {}) => {
          if (!StudyInstanceUID || StudyInstanceUID === PLACEHOLDER_STUDY_UID) {
            return;
          }

          if (_store.loadedStudies.has(StudyInstanceUID)) {
            // Verify the study still exists in DicomMetadataStore.
            // Module-level _store persists across route changes, but the metadata
            // store may be in a different state. Reprocess if the study is missing.
            if (DicomMetadataStore.getStudy(StudyInstanceUID)) {
              console.log('[FHIR] metadata() — study already loaded, skipping:', StudyInstanceUID);
              return;
            }
            console.warn('[FHIR] metadata() — study marked loaded but missing from DicomMetadataStore, reprocessing:', StudyInstanceUID);
            _store.loadedStudies.delete(StudyInstanceUID);
          }

          console.log('[FHIR] metadata() called for StudyInstanceUID:', StudyInstanceUID);

          try {
          const opts = { authToken: _config.authToken };

          // ── Try ImagingStudy series/instance data first ──
          let imagingStudy = _store.imagingStudyMap.get(StudyInstanceUID);

          if (!imagingStudy) {
            // Re-fetch if not cached (e.g. deep-link scenario)
            const fhirStudyId = _store.studyToFhirId.get(StudyInstanceUID);
            if (fhirStudyId) {
              try {
                imagingStudy = await fetchImagingStudyById(
                  _config.fhirBaseUrl,
                  fhirStudyId,
                  opts
                );
              } catch (error) {
                console.warn('[FHIR] Could not re-fetch ImagingStudy:', error);
              }
            }
          }

          console.log('[FHIR] metadata() — imagingStudy found:', !!imagingStudy, 'for', StudyInstanceUID);

          if (imagingStudy) {
            // Ensure the study exists in DicomMetadataStore with FHIR metadata.
            // The hanging protocol requires every StudyInstanceUID to resolve —
            // without this, studies with no series/instances cause a crash.
            const studySummary = imagingStudyToStudySummary(imagingStudy, '');
            DicomMetadataStore.addStudy({
              StudyInstanceUID,
              PatientID: studySummary.PatientID,
              PatientName: studySummary.PatientName,
              StudyDate: studySummary.StudyDate,
              ModalitiesInStudy: studySummary.Modalities
                ? studySummary.Modalities.split('\\')
                : [],
              StudyDescription: studySummary.StudyDescription,
              AccessionNumber: studySummary.AccessionNumber,
              NumInstances: studySummary.NumInstances,
            });
            console.log('[FHIR] metadata() — addStudy called, verify:', !!DicomMetadataStore.getStudy(StudyInstanceUID));

            // Diagnostic: log what keys the cached ImagingStudy has
            console.log('[FHIR] Cached ImagingStudy keys:', Object.keys(imagingStudy));

            // Log endpoint references (diagnostic — shows if WADO-RS is available)
            if (imagingStudy.endpoint && imagingStudy.endpoint.length > 0) {
              console.log('[FHIR] ImagingStudy endpoint references:', imagingStudy.endpoint);
            }

            let { seriesList, instancesBySeriesUID } = extractSeriesMetadata(
              imagingStudy,
              StudyInstanceUID
            );

            // If cached ImagingStudy has no series data, re-fetch the full resource by ID
            if (seriesList.length === 0) {
              const fhirStudyId = imagingStudy.id || _store.studyToFhirId.get(StudyInstanceUID);
              if (fhirStudyId) {
                console.log('[FHIR] Re-fetching full ImagingStudy by ID...');
                try {
                  const fullStudy = await fetchImagingStudyById(
                    _config.fhirBaseUrl,
                    fhirStudyId,
                    opts
                  );
                  if (fullStudy) {
                    // Update cache with the full resource
                    _store.imagingStudyMap.set(StudyInstanceUID, fullStudy);
                    imagingStudy = fullStudy;
                    ({ seriesList, instancesBySeriesUID } = extractSeriesMetadata(
                      fullStudy,
                      StudyInstanceUID
                    ));
                    if (seriesList.length === 0) {
                      console.log('[FHIR] Full ImagingStudy also has no series data');
                    }
                  }
                } catch (error) {
                  console.warn('[FHIR] Could not re-fetch full ImagingStudy:', error);
                }
              }
            }

            // If the launch URL includes a gridfsFileId, use it to override
            // stale extension values in the ImagingStudy. The RIS constructs
            // the launch URL from the current GridFS file, so it's authoritative.
            const urlGridfsFileId = _config.urlParams?.gridfsFileId;
            if (urlGridfsFileId) {
              let gridfsInstanceCount = 0;
              for (const [, instances] of instancesBySeriesUID) {
                for (const inst of instances) {
                  if (inst.gridfsFileId) gridfsInstanceCount++;
                }
              }
              // Only override for single-instance studies (we can't map a single
              // URL param to multiple instances)
              if (gridfsInstanceCount === 1) {
                for (const [, instances] of instancesBySeriesUID) {
                  for (const inst of instances) {
                    if (inst.gridfsFileId && inst.gridfsFileId !== urlGridfsFileId) {
                      console.warn(
                        '[FHIR] Overriding stale gridfsFileId from ImagingStudy extension:',
                        inst.gridfsFileId, '→', urlGridfsFileId
                      );
                      inst.gridfsFileId = urlGridfsFileId;
                    }
                  }
                }
              }
            }

            console.log('[FHIR] metadata() — seriesList.length:', seriesList.length, 'for', StudyInstanceUID);

            if (seriesList.length > 0) {
              let totalInstances = 0;
              const hasGridFs = seriesList.some(seriesMeta => {
                const instances = instancesBySeriesUID.get(seriesMeta.SeriesInstanceUID) || [];
                return instances.some(inst => inst.gridfsFileId);
              });

              if (hasGridFs) {
                // ── GridFS path: fetch DICOM files, parse metadata, use blob URLs ──
                console.log('[FHIR] Instances have gridfsFileId — fetching DICOM from GridFS');

                // Collect all instances that need fetching
                const fetchTasks = [];
                for (const seriesMeta of seriesList) {
                  const instances = instancesBySeriesUID.get(seriesMeta.SeriesInstanceUID) || [];
                  totalInstances += instances.length;
                  for (const inst of instances) {
                    if (inst.gridfsFileId) {
                      fetchTasks.push({ inst, seriesMeta });
                    } else {
                      // Non-GridFS instance — use WADO-RS fallback
                      const imageId = `dicomweb:${_config.fhirBaseUrl}/studies/${StudyInstanceUID}/series/${seriesMeta.SeriesInstanceUID}/instances/${inst.SOPInstanceUID}`;
                      inst.url = imageId;
                      inst.imageId = imageId;
                      metadataProvider.addImageIdToUIDs(imageId, {
                        StudyInstanceUID,
                        SeriesInstanceUID: seriesMeta.SeriesInstanceUID,
                        SOPInstanceUID: inst.SOPInstanceUID,
                      });
                    }
                  }
                }

                // Fetch with concurrency limit
                const CONCURRENCY = 6;
                for (let i = 0; i < fetchTasks.length; i += CONCURRENCY) {
                  const batch = fetchTasks.slice(i, i + CONCURRENCY);
                  const results = await Promise.allSettled(
                    batch.map(async ({ inst, seriesMeta }) => {
                      const filePath = `/api/dicom/files/${inst.gridfsFileId}`;
                      const arrayBuffer = await fetchDicomFile(
                        _config.fhirServerRoot,
                        filePath,
                        { authToken: _config.authToken }
                      );

                      const metadata = parseDicomArrayBuffer(
                        arrayBuffer,
                        `GridFS:${inst.gridfsFileId}`
                      );

                      const blob = new Blob([arrayBuffer], { type: 'application/dicom' });
                      const blobUrl = URL.createObjectURL(blob);
                      const imageId = `wadouri:${blobUrl}`;

                      Object.assign(inst, wrapSequences(metadata));
                      // Restore FHIR-assigned UIDs — the DICOM file may contain different
                      // StudyInstanceUID/SeriesInstanceUID than what FHIR uses. The rest
                      // of the system (routing, DicomMetadataStore, hanging protocol) relies
                      // on the FHIR UIDs, so we must preserve them.
                      inst.StudyInstanceUID = StudyInstanceUID;
                      inst.SeriesInstanceUID = seriesMeta.SeriesInstanceUID;
                      inst.url = imageId;
                      inst.imageId = imageId;

                      metadataProvider.addImageIdToUIDs(imageId, {
                        StudyInstanceUID,
                        SeriesInstanceUID: seriesMeta.SeriesInstanceUID,
                        SOPInstanceUID: inst.SOPInstanceUID,
                      });
                    })
                  );

                  for (const result of results) {
                    if (result.status === 'rejected') {
                      console.warn('[FHIR] GridFS fetch failed for an instance:', result.reason?.message);
                    }
                  }
                }
              } else {
                // ── WADO-RS path: construct DICOMweb URLs (for DICOMweb-capable servers) ──
                for (const seriesMeta of seriesList) {
                  const instances = instancesBySeriesUID.get(seriesMeta.SeriesInstanceUID) || [];
                  totalInstances += instances.length;

                  for (const inst of instances) {
                    const imageId = `dicomweb:${_config.fhirBaseUrl}/studies/${StudyInstanceUID}/series/${seriesMeta.SeriesInstanceUID}/instances/${inst.SOPInstanceUID}`;
                    inst.url = imageId;
                    inst.imageId = imageId;

                    metadataProvider.addImageIdToUIDs(imageId, {
                      StudyInstanceUID,
                      SeriesInstanceUID: seriesMeta.SeriesInstanceUID,
                      SOPInstanceUID: inst.SOPInstanceUID,
                    });
                  }
                }
              }

              console.log(`[FHIR] Loaded ${seriesList.length} series with ${totalInstances} instances from ImagingStudy`);

              DicomMetadataStore.addSeriesMetadata(seriesList, madeInClient);

              for (const [, instances] of instancesBySeriesUID) {
                if (instances.length > 0) {
                  DicomMetadataStore.addInstances(instances, madeInClient);
                }
              }

              _store.loadedStudies.add(StudyInstanceUID);

              const study = DicomMetadataStore.getStudy(StudyInstanceUID, madeInClient);
              if (study) {
                study.isLoaded = true;
              }

              return;
            }
          }

          // ── Fallback: DocumentReference path (for servers without ImagingStudy series data) ──
          console.log('[FHIR] ImagingStudy has no series data, falling back to DocumentReferences');

          const fhirStudyId = _store.studyToFhirId.get(StudyInstanceUID);
          let docBundle;
          try {
            docBundle = await fetchDocumentReferences(
              _config.fhirBaseUrl,
              {
                patientId: _config.patientId,
                imagingStudyId: fhirStudyId,
              },
              opts
            );
          } catch (error) {
            console.error('[FHIR] Failed to fetch DocumentReferences:', error);
            return;
          }

          const docEntries = docBundle.entry || [];
          const documents = docEntries.map(e => e.resource);
          console.log('[FHIR] metadata() — DocumentReferences found:', documents.length, 'documents for', StudyInstanceUID);

          const seriesMap = new Map();

          for (const doc of documents) {
            if (!doc.content || doc.content.length === 0) continue;

            for (const content of doc.content) {
              const attachment = content.attachment;
              if (!attachment) continue;

              try {
                const { imageId, metadata } = await loadDicomFromAttachment(
                  attachment,
                  _config.fhirServerRoot,
                  _config.authToken
                );

                const SeriesInstanceUID = metadata.SeriesInstanceUID;
                const SOPInstanceUID = metadata.SOPInstanceUID;

                if (!seriesMap.has(SeriesInstanceUID)) {
                  seriesMap.set(SeriesInstanceUID, {
                    SeriesInstanceUID,
                    StudyInstanceUID,
                    SeriesDescription: metadata.SeriesDescription || '',
                    SeriesNumber: metadata.SeriesNumber || '',
                    Modality: metadata.Modality || '',
                    instances: [],
                  });
                }

                const wrappedMetadata = wrapSequences(metadata);

                const instanceData = {
                  ...wrappedMetadata,
                  StudyInstanceUID,
                  SeriesInstanceUID,
                  SOPInstanceUID,
                  url: imageId,
                  imageId,
                };

                seriesMap.get(SeriesInstanceUID).instances.push(instanceData);

                metadataProvider.addImageIdToUIDs(imageId, {
                  StudyInstanceUID,
                  SeriesInstanceUID,
                  SOPInstanceUID,
                });
              } catch (error) {
                console.warn('[FHIR] Failed to load DICOM from attachment:', error.message);
              }
            }
          }

          const seriesSummaryMetadata = [];
          for (const [, seriesData] of seriesMap) {
            const { instances, ...seriesSummary } = seriesData;
            seriesSummaryMetadata.push(seriesSummary);
          }

          console.log('[FHIR] metadata() — DocumentReferences produced', seriesSummaryMetadata.length, 'series for', StudyInstanceUID);

          if (seriesSummaryMetadata.length > 0) {
            DicomMetadataStore.addSeriesMetadata(seriesSummaryMetadata, madeInClient);

            for (const [, seriesData] of seriesMap) {
              DicomMetadataStore.addInstances(seriesData.instances, madeInClient);
            }
          }

          _store.loadedStudies.add(StudyInstanceUID);

          const study = DicomMetadataStore.getStudy(StudyInstanceUID, madeInClient);
          if (study) {
            study.isLoaded = true;
          }

          } finally {
            // Safety net: guarantee every processed StudyInstanceUID has a study
            // in DicomMetadataStore, regardless of which code path executed.
            if (!DicomMetadataStore.getStudy(StudyInstanceUID)) {
              console.warn('[FHIR] Safety net — creating minimal study for:', StudyInstanceUID);
              DicomMetadataStore.addStudy({
                StudyInstanceUID,
                PatientID: '',
                PatientName: '',
                StudyDate: '',
                ModalitiesInStudy: [],
                StudyDescription: '',
                AccessionNumber: '',
                NumInstances: 0,
              });
            }
            console.log('[FHIR] metadata() — complete for', StudyInstanceUID, ', study in store:', !!DicomMetadataStore.getStudy(StudyInstanceUID));
          }
        },
      },
    },

    store: {
      dicom: async (dataset) => {
        console.log('[FHIR] store.dicom called — creating DocumentReference for SR');

        // 1. Convert naturalized dataset to DICOM Part 10 binary
        const { DicomDict, DicomMetaDictionary } = dcmjs.data;
        const meta = {
          MediaStorageSOPClassUID: dataset.SOPClassUID,
          MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
          TransferSyntaxUID: '1.2.840.10008.1.2.1',
          ImplementationClassUID: '2.25.270695996825855179949881587723571202391',
          ImplementationVersionName: 'OHIF-FHIR-SR-0.1',
        };
        const denaturalized = DicomMetaDictionary.denaturalizeDataset(meta);
        const dicomDict = new DicomDict(denaturalized);
        dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
        const part10Buffer = dicomDict.write();

        // 2. Base64-encode for FHIR attachment
        const base64Data = arrayBufferToBase64(part10Buffer);
        console.log('[FHIR] SR encoded — Part10 size:', part10Buffer.byteLength, 'bytes, base64 length:', base64Data.length);

        // 3. Build FHIR DocumentReference
        const patientId = _config.patientId;
        const docRef = {
          resourceType: 'DocumentReference',
          status: 'current',
          type: {
            coding: [{
              system: 'http://loinc.org',
              code: '18748-4',
              display: 'Diagnostic imaging study',
            }],
          },
          subject: patientId ? { reference: `Patient/${patientId}` } : undefined,
          description: 'DICOM Structured Report — TID 1500 Imaging Measurement Report',
          content: [{
            attachment: {
              contentType: 'application/dicom',
              data: base64Data,
            },
          }],
        };

        // 4. POST to FHIR server
        const result = await createDocumentReference(_config.fhirBaseUrl, docRef, {
          authToken: _config.authToken,
        });
        console.log('[FHIR] DocumentReference created:', result.id);
        return result;
      },
    },

    getImageIdsForDisplaySet(displaySet) {
      const images = displaySet.images;
      const imageIds = [];

      if (!images) return imageIds;

      images.forEach(instance => {
        const NumberOfFrames = instance.NumberOfFrames || 1;
        if (NumberOfFrames > 1) {
          for (let i = 0; i < NumberOfFrames; i++) {
            const frameImageId = instance.imageId
              ? `${instance.imageId}&frame=${i}`
              : instance.url
                ? `${instance.url}&frame=${i}`
                : '';
            if (frameImageId) imageIds.push(frameImageId);
          }
        } else {
          const imageId = instance.imageId || instance.url || '';
          if (imageId) imageIds.push(imageId);
        }
      });

      return imageIds;
    },

    getImageIdsForInstance({ instance, frame }) {
      const baseImageId = instance.imageId || instance.url || '';
      if (frame !== undefined) {
        return `${baseImageId}&frame=${frame}`;
      }
      return baseImageId;
    },

    deleteStudyMetadataPromise: (StudyInstanceUID) => {
      console.log('[FHIR] deleteStudyMetadataPromise called for', StudyInstanceUID);
      _store.loadedStudies.delete(StudyInstanceUID);
    },

    getStudyInstanceUIDs: ({ params, query } = {}) => {
      return _store.studyInstanceUIDs;
    },
  };

  return IWebApiDataSource.create(implementation);
}

export { createFhirApi, PLACEHOLDER_STUDY_UID, registerSmartClient };
