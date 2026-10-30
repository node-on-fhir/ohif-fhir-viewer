/**
 * @jest-environment jsdom
 */
/**
 * Tests for the DICOMweb image-source delegation in the FHIR data source
 * (FhirDataSource/index.js), added by the fhircast-dicomweb-and-persistent-session
 * PR.
 *
 * The contract under test:
 *  - opt-in: with no DICOMweb root configured, nothing delegates and the
 *    extensionManager is never asked for the dicomweb module (behavior
 *    unchanged);
 *  - when a root is configured and an ImagingStudy has series but no instances,
 *    instance metadata comes from the DICOMweb delegate;
 *  - the SMART bearer token is bridged into OHIF's userAuthenticationService so
 *    the delegated WADO/QIDO requests carry it;
 *  - getStudyInstanceUIDs honors a StudyInstanceUIDs query/route param and lists
 *    it first.
 *
 * @ohif/core and the sibling modules are mocked so the test is about the data
 * source's own logic, not FHIR fetching or OHIF internals.
 */

// ── mocks ────────────────────────────────────────────────────────────────────
// The store lives in a `mock`-prefixed outer variable (the only non-import
// reference jest allows in a hoisted factory). Keeping it outside the factory
// means the test and the data source share one store even though the virtual
// module's factory runs more than once.
const mockStudyStore = new Map();
const mockDicomMetadataStore = {
  addStudy: study => {
    const existing = mockStudyStore.get(study.StudyInstanceUID) || { series: [] };
    mockStudyStore.set(study.StudyInstanceUID, { ...existing, ...study, series: existing.series });
  },
  getStudy: uid => mockStudyStore.get(uid),
  addSeriesMetadata: () => {},
  addInstances: () => {},
  _addSeries: (uid, series) => {
    const s = mockStudyStore.get(uid) || { StudyInstanceUID: uid, series: [] };
    s.series = [...(s.series || []), series];
    mockStudyStore.set(uid, s);
  },
};
jest.mock('@ohif/core', () => ({
  __esModule: true,
  DicomMetadataStore: mockDicomMetadataStore,
  IWebApiDataSource: { create: impl => impl },
  default: {
    classes: { MetadataProvider: class {} },
    utils: { addAccessors: x => x },
  },
}), { virtual: true });

const mockExtractSeriesMetadata = jest.fn();
const mockImagingStudyToStudySummary = jest.fn();
jest.mock('../fhirToOhif', () => ({
  imagingStudyToStudySummary: (...a) => mockImagingStudyToStudySummary(...a),
  extractSeriesMetadata: (...a) => mockExtractSeriesMetadata(...a),
}));

jest.mock('../fhirClient', () => ({
  fetchPatient: jest.fn(),
  fetchImagingStudies: jest.fn(),
  fetchImagingStudyById: jest.fn(async () => null),
  fetchDocumentReferences: jest.fn(),
  fetchDicomFile: jest.fn(),
  createDocumentReference: jest.fn(),
}));
jest.mock('../dicomLoader', () => ({
  loadDicomFromAttachment: jest.fn(),
  parseDicomArrayBuffer: jest.fn(),
}));
jest.mock('../smartAuth', () => ({
  fetchSmartConfiguration: jest.fn(),
  generatePKCE: jest.fn(),
  buildAuthorizationUrl: jest.fn(),
  exchangeCodeForToken: jest.fn(),
  saveAuthState: jest.fn(),
  loadAuthState: jest.fn(),
  clearAuthState: jest.fn(),
  saveToken: jest.fn(),
  getStoredToken: jest.fn(),
  registerSmartClient: jest.fn(),
}));
jest.mock('../../envConfig', () => ({
  getEnvSmartClientId: () => '',
  getEnvFhirServerUrl: () => '',
}));
jest.mock('dcmjs', () => ({ data: {}, utilities: {} }), { virtual: true });

function makeServices() {
  // Mirrors OHIF's UserAuthenticationService: setServiceImplementation stores
  // the function as serviceImplementation._getAuthorizationHeader (which is
  // what the auth bridge captures as `previous`), and the public method
  // dispatches to it.
  const impl = {};
  return {
    services: {
      userAuthenticationService: {
        serviceImplementation: impl,
        setServiceImplementation: jest.fn(({ getAuthorizationHeader }) => {
          if (getAuthorizationHeader) {
            impl._getAuthorizationHeader = getAuthorizationHeader;
          }
        }),
        getAuthorizationHeader() {
          return impl._getAuthorizationHeader?.();
        },
      },
      displaySetService: { getActiveDisplaySets: () => [] },
      uiNotificationService: { show: jest.fn() },
    },
  };
}

function makeDelegate() {
  const delegate = {
    initialize: jest.fn(),
    retrieve: {
      series: {
        metadata: jest.fn(async ({ StudyInstanceUID }) => {
          // A real delegate populates DicomMetadataStore with series. Set the
          // study outright so the series count the data source checks is
          // non-empty regardless of any prior addStudy in the same flow.
          mockStudyStore.set(StudyInstanceUID, {
            StudyInstanceUID,
            series: [{ SeriesInstanceUID: 's1', instances: [{}] }],
          });
        }),
      },
      directURL: jest.fn(() => 'wadors:frame'),
      getGetThumbnailSrc: jest.fn(() => 'thumb'),
      bulkDataURI: jest.fn(() => 'bulk'),
    },
    getImageIdsForDisplaySet: jest.fn(() => ['wadors:img-1']),
    getImageIdsForInstance: jest.fn(() => 'wadors:img-1&frame=1'),
    deleteStudyMetadataPromise: jest.fn(),
  };
  return delegate;
}

function makeExtensionManager(delegate) {
  return {
    getModuleEntry: jest.fn(() => ({ createDataSource: jest.fn(() => delegate) })),
  };
}

describe('FhirDataSource DICOMweb delegation', () => {
  let mod;
  let api;
  let services;
  let delegate;
  let extensionManager;
  const DicomMetadataStore = mockDicomMetadataStore;

  beforeEach(() => {
    // Fresh module registry per test: the data source keeps module-level _store
    // (dicomWebAttempted/loadedStudies), which would otherwise leak between tests.
    jest.resetModules();
    mockStudyStore.clear();
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockImagingStudyToStudySummary.mockImplementation(study => ({
      StudyInstanceUID: study.__uid || '',
      PatientID: 'pat-1',
      PatientName: 'Doe^Jane',
      StudyDate: '20260101',
      Modalities: 'MR',
      StudyDescription: '',
      AccessionNumber: '',
      NumInstances: 0,
    }));
    localStorage.clear();
    mod = require('../index');
  });

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  function init(config) {
    services = makeServices();
    delegate = makeDelegate();
    extensionManager = makeExtensionManager(delegate);
    api = mod.createFhirApi(config, services, extensionManager);
  }

  describe('opt-in: no DICOMweb root configured', () => {
    beforeEach(() => {
      init({ fhirBaseUrl: 'http://fhir.test/R4', smartClientId: 'c1' });
    });

    it('never asks the extensionManager for the dicomweb module', () => {
      api.getImageIdsForDisplaySet({ StudyInstanceUID: 'nope', images: [] });
      expect(extensionManager.getModuleEntry).not.toHaveBeenCalled();
    });

    it('builds image ids from FHIR attachments, not the delegate', () => {
      const ids = api.getImageIdsForDisplaySet({
        StudyInstanceUID: 'fhir-study',
        images: [{ imageId: 'wadouri:a' }, { imageId: 'wadouri:b', NumberOfFrames: 2 }],
      });
      expect(ids).toEqual(['wadouri:a', 'wadouri:b&frame=0', 'wadouri:b&frame=1']);
      expect(delegate.getImageIdsForDisplaySet).not.toHaveBeenCalled();
    });

    it('returns undefined for thumbnail/bulkdata rather than hitting a DICOMweb server', () => {
      expect(api.retrieve.getGetThumbnailSrc({ StudyInstanceUID: 'x' }, 'id')).toBeUndefined();
      expect(api.retrieve.bulkDataURI({ StudyInstanceUID: 'x' })).toBeUndefined();
    });
  });

  describe('dicomWebRoot expands to all three service roots', () => {
    it('passes qido/wado/wadoUri roots to the delegate module', async () => {
      init({
        fhirBaseUrl: 'http://fhir.test/R4',
        dicomWebRoot: 'http://dcm.test/dicomweb',
      });
      // series-but-no-instances study → delegation
      mockExtractSeriesMetadata.mockReturnValue({
        seriesList: [{ SeriesInstanceUID: 's1' }],
        instancesBySeriesUID: new Map([['s1', []]]),
      });
      await mod.registerImagingStudyContext({ resourceType: 'ImagingStudy', id: 'is1', __uid: '1.2.3', series: [{}] });

      await api.retrieve.series.metadata({ StudyInstanceUID: '1.2.3' });

      const moduleEntry = extensionManager.getModuleEntry.mock.results[0].value;
      const [cfg] = moduleEntry.createDataSource.mock.calls[0];
      expect(cfg.qidoRoot).toBe('http://dcm.test/dicomweb');
      expect(cfg.wadoRoot).toBe('http://dcm.test/dicomweb');
      expect(cfg.wadoUriRoot).toBe('http://dcm.test/dicomweb');
    });

    it('lets explicit qidoRoot/wadoRoot override the shared root', async () => {
      init({
        fhirBaseUrl: 'http://fhir.test/R4',
        dicomWebRoot: 'http://shared.test/ddriver',
        qidoRoot: 'http://qido.test',
        wadoRoot: 'http://wado.test',
      });
      mockExtractSeriesMetadata.mockReturnValue({
        seriesList: [{ SeriesInstanceUID: 's1' }],
        instancesBySeriesUID: new Map([['s1', []]]),
      });
      await mod.registerImagingStudyContext({ resourceType: 'ImagingStudy', id: 'is1', __uid: '1.2.3', series: [{}] });
      await api.retrieve.series.metadata({ StudyInstanceUID: '1.2.3' });

      const moduleEntry = extensionManager.getModuleEntry.mock.results[0].value;
      const [cfg] = moduleEntry.createDataSource.mock.calls[0];
      expect(cfg.qidoRoot).toBe('http://qido.test');
      expect(cfg.wadoRoot).toBe('http://wado.test');
    });
  });

  describe('delegation of an instance-less ImagingStudy', () => {
    beforeEach(async () => {
      init({ fhirBaseUrl: 'http://fhir.test/R4', dicomWebRoot: 'http://dcm.test/dicomweb' });
      mockExtractSeriesMetadata.mockReturnValue({
        seriesList: [{ SeriesInstanceUID: 's1' }],
        instancesBySeriesUID: new Map([['s1', []]]),
      });
      await mod.registerImagingStudyContext({ resourceType: 'ImagingStudy', id: 'is1', __uid: '1.2.3', series: [{}] });
    });

    it('pulls series metadata from the delegate and marks the study delegated', async () => {
      await api.retrieve.series.metadata({ StudyInstanceUID: '1.2.3' });
      expect(delegate.retrieve.series.metadata).toHaveBeenCalledWith(
        expect.objectContaining({ StudyInstanceUID: '1.2.3' })
      );
      // Now image ids and thumbnails route through the delegate for this study.
      expect(api.getImageIdsForDisplaySet({ StudyInstanceUID: '1.2.3' })).toEqual(['wadors:img-1']);
      expect(api.retrieve.getGetThumbnailSrc({ StudyInstanceUID: '1.2.3' }, 'id')).toBe('thumb');
    });
  });

  describe('SMART token bridging', () => {
    it('installs an auth header implementation that returns the configured bearer token', async () => {
      init({
        fhirBaseUrl: 'http://fhir.test/R4',
        dicomWebRoot: 'http://dcm.test/dicomweb',
        authToken: 'smart-abc',
      });
      mockExtractSeriesMetadata.mockReturnValue({
        seriesList: [{ SeriesInstanceUID: 's1' }],
        instancesBySeriesUID: new Map([['s1', []]]),
      });
      await mod.registerImagingStudyContext({ resourceType: 'ImagingStudy', id: 'is1', __uid: '1.2.3', series: [{}] });
      await api.retrieve.series.metadata({ StudyInstanceUID: '1.2.3' });

      const uas = services.services.userAuthenticationService;
      expect(uas.setServiceImplementation).toHaveBeenCalled();
      expect(uas.getAuthorizationHeader()).toEqual({ Authorization: 'Bearer smart-abc' });
    });

    it('falls back to the previous implementation without recursing when there is no SMART token', async () => {
      // The "OHIF OIDC login, no SMART launch" case: the bridge must return the
      // header of the implementation it replaced, and must not call the public
      // getAuthorizationHeader() (which dispatches back to the bridge — the
      // recursion found in review).
      init({
        fhirBaseUrl: 'http://fhir.test/R4',
        dicomWebRoot: 'http://dcm.test/dicomweb',
      });
      const previous = jest.fn(() => ({ Authorization: 'Bearer ohif-oidc' }));
      services.services.userAuthenticationService.serviceImplementation._getAuthorizationHeader =
        previous;

      mockExtractSeriesMetadata.mockReturnValue({
        seriesList: [{ SeriesInstanceUID: 's1' }],
        instancesBySeriesUID: new Map([['s1', []]]),
      });
      await mod.registerImagingStudyContext({ resourceType: 'ImagingStudy', id: 'is1', __uid: '1.2.3', series: [{}] });
      await api.retrieve.series.metadata({ StudyInstanceUID: '1.2.3' });

      const uas = services.services.userAuthenticationService;
      const publicSpy = jest.spyOn(uas, 'getAuthorizationHeader');
      // Only count from here — the retrieve above legitimately reads the header.
      previous.mockClear();

      expect(uas.getAuthorizationHeader()).toEqual({ Authorization: 'Bearer ohif-oidc' });
      // Exactly the one external call — the bridge never re-enters the service.
      expect(publicSpy).toHaveBeenCalledTimes(1);
      expect(previous).toHaveBeenCalledTimes(1);
    });
  });

  describe('DICOMweb root change (updateFhirConfig)', () => {
    beforeEach(async () => {
      init({ fhirBaseUrl: 'http://fhir.test/R4', dicomWebRoot: 'http://old.test/dicomweb' });
      mockExtractSeriesMetadata.mockReturnValue({
        seriesList: [{ SeriesInstanceUID: 's1' }],
        instancesBySeriesUID: new Map([['s1', []]]),
      });
      await mod.registerImagingStudyContext({ resourceType: 'ImagingStudy', id: 'is1', __uid: '1.2.3', series: [{}] });
      await api.retrieve.series.metadata({ StudyInstanceUID: '1.2.3' });
      expect(api.getImageIdsForDisplaySet({ StudyInstanceUID: '1.2.3' })).toEqual(['wadors:img-1']);
      // The study is on screen when the root changes mid-session.
      services.services.displaySetService.getActiveDisplaySets = () => [
        { StudyInstanceUID: '1.2.3' },
      ];
    });

    it('reloads a previously delegated study against the new server instead of skipping it', async () => {
      const delegateB = makeDelegate();
      extensionManager.getModuleEntry.mockImplementation(() => ({
        createDataSource: jest.fn(() => delegateB),
      }));
      mod.updateFhirConfig({ dicomWebRoot: 'http://new.test/dicomweb' });

      await api.retrieve.series.metadata({ StudyInstanceUID: '1.2.3' });
      expect(delegateB.retrieve.series.metadata).toHaveBeenCalledWith(
        expect.objectContaining({ StudyInstanceUID: '1.2.3' })
      );
    });

    it('does not throw image-id lookups at a delegate that failed to rebuild', () => {
      extensionManager.getModuleEntry.mockImplementation(() => ({
        createDataSource: jest.fn(() => {
          throw new Error('new root unreachable');
        }),
      }));
      mod.updateFhirConfig({ dicomWebRoot: 'http://new.test/dicomweb' });

      // Falls back to the FHIR-attachment path (empty here) instead of a
      // TypeError on a null delegate.
      expect(() => api.getImageIdsForDisplaySet({ StudyInstanceUID: '1.2.3', images: [] })).not.toThrow();
      expect(api.getImageIdsForDisplaySet({ StudyInstanceUID: '1.2.3', images: [] })).toEqual([]);
      expect(api.getImageIdsForInstance({ instance: { StudyInstanceUID: '1.2.3' } })).toBe('');
    });
  });

  describe('getStudyInstanceUIDs', () => {
    beforeEach(() => {
      init({ fhirBaseUrl: 'http://fhir.test/R4' });
    });

    it('returns the placeholder when nothing is requested or stored', () => {
      expect(api.getStudyInstanceUIDs({})).toEqual([mod.PLACEHOLDER_STUDY_UID]);
    });

    it('lists a StudyInstanceUIDs query param first', () => {
      const query = new URLSearchParams('StudyInstanceUIDs=1.2.3');
      expect(api.getStudyInstanceUIDs({ query })).toEqual(['1.2.3']);
    });

    it('honors a StudyInstanceUIDs route param', () => {
      expect(api.getStudyInstanceUIDs({ params: { StudyInstanceUIDs: '9.9.9' } })).toEqual(['9.9.9']);
    });

    it('splits a comma-separated list and dedupes while preserving order', () => {
      const query = new URLSearchParams('StudyInstanceUIDs=1.1,2.2,1.1');
      expect(api.getStudyInstanceUIDs({ query })).toEqual(['1.1', '2.2']);
    });

    it('puts the requested study ahead of the ones already in the store', async () => {
      mockExtractSeriesMetadata.mockReturnValue({ seriesList: [], instancesBySeriesUID: new Map() });
      // Seed the store with a context study (goes to the front of _store list).
      await mod.registerImagingStudyContext({ resourceType: 'ImagingStudy', id: 'ctx', __uid: 'store-uid', series: [{}] });
      const query = new URLSearchParams('StudyInstanceUIDs=requested-uid');
      expect(api.getStudyInstanceUIDs({ query })).toEqual(['requested-uid', 'store-uid']);
    });
  });
});
