/**
 * @jest-environment jsdom
 */
/**
 * Tests for the module-scoped FHIRcast context listener
 * (fhircastContextListener.ts).
 *
 * It listens to the session store and, for events that put a study in focus,
 * registers the ImagingStudy and navigates the viewer to it — all from module
 * scope so it keeps working while the FHIRcast tab is not the active one. These
 * tests drive it through the real session store and assert on the mocked
 * data-source registration and the mocked navigate command.
 */
const { MockWebSocket, flushMicrotasks } = require('./helpers/mockWebSocket');

// The listener imports registerImagingStudyContext from the data source; mock it
// so these tests stay about event handling, not FHIR fetching.
const mockRegister = jest.fn();
jest.mock('../../../FhirDataSource', () => ({
  registerImagingStudyContext: (...args) => mockRegister(...args),
}));

// The confirm dialog is a React component rendered by OHIF's modal service;
// these tests assert on the uiModalService calls, not on its rendering.
jest.mock('../FhircastNavigationConfirm', () => ({ __esModule: true, default: () => null }));

function imagingStudyEvent(hubEvent, resource, id = Math.random().toString(36).slice(2)) {
  return {
    id,
    timestamp: '2026-01-01T00:00:00Z',
    event: {
      'hub.topic': 'topic-1',
      'hub.event': hubEvent,
      context: [{ key: 'study', resource }],
    },
  };
}

describe('fhircastContextListener', () => {
  let session;
  let listener;
  let runCommand;
  let uiNotificationService;

  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers();
    MockWebSocket.reset();
    global.WebSocket = MockWebSocket;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 202,
      statusText: 'Accepted',
      json: async () => ({ 'hub.channel.endpoint': 'ws://hub.example/bind/ep-1' }),
    }));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    mockRegister.mockReset();

    session = require('../fhircastSession');
    listener = require('../fhircastContextListener');

    runCommand = jest.fn();
    uiNotificationService = { show: jest.fn() };

    // A viewer route must be active for navigation to fire.
    window.history.pushState({}, '', '/fhir-viewer?iss=http://x');

    listener.startFhircastContextListener({
      servicesManager: { services: { uiNotificationService } },
      commandsManager: { runCommand },
    });

    // Open a live connection so events can arrive through the store.
    const done = session.startSubscription({
      hubUrl: 'http://hub.example/api/hub',
      wsUrl: 'ws://hub.example/bind',
      topic: 'topic-1',
      events: ['ImagingStudy-open'],
    });
    done.catch(() => {});
    await flushMicrotasks();
    MockWebSocket.last.serverBind();
  });

  afterEach(async () => {
    listener.stopFhircastContextListener();
    await session.stopSubscription();
    await flushMicrotasks();
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete global.WebSocket;
    delete global.fetch;
  });

  async function deliver(event) {
    MockWebSocket.last.serverEvent(event);
    await flushMicrotasks();
  }

  it('registers the study and navigates on ImagingStudy-open', async () => {
    mockRegister.mockResolvedValue({ StudyInstanceUID: '1.2.3', patientId: 'pat-7' });

    await deliver(imagingStudyEvent('ImagingStudy-open', { resourceType: 'ImagingStudy', id: 'is-1' }));

    expect(mockRegister).toHaveBeenCalledWith({ resourceType: 'ImagingStudy', id: 'is-1' });
    expect(runCommand).toHaveBeenCalledTimes(1);
    const [name, args] = runCommand.mock.calls[0];
    expect(name).toBe('navigateHistory');
    expect(args.to).toContain('/fhir-viewer?');
    expect(args.to).toContain('StudyInstanceUIDs=1.2.3');
    expect(args.to).toContain('patient=pat-7');

    // Context is mirrored onto the session for the panel to show.
    expect(session.getSessionSnapshot()).toMatchObject({
      imagingStudyId: 'is-1',
      imagingStudyStatus: 'unknown',
    });
  });

  it('treats a stub resource as a full open — registration is what resolves the UID', async () => {
    // The stub has only an id; registerImagingStudyContext does the fetch.
    mockRegister.mockResolvedValue({ StudyInstanceUID: '9.9.9', patientId: '' });
    await deliver(imagingStudyEvent('ImagingStudy-open', { resourceType: 'ImagingStudy', id: 'stub' }));
    expect(mockRegister).toHaveBeenCalledWith({ resourceType: 'ImagingStudy', id: 'stub' });
    expect(runCommand).toHaveBeenCalledWith('navigateHistory', expect.objectContaining({
      to: expect.stringContaining('StudyInstanceUIDs=9.9.9'),
    }));
  });

  it('opens the study a DiagnosticReport-open reports on', async () => {
    mockRegister.mockResolvedValue({ StudyInstanceUID: '4.5.6', patientId: 'pat-2' });
    await deliver(imagingStudyEvent('DiagnosticReport-open', { resourceType: 'ImagingStudy', id: 'is-2' }));
    expect(runCommand).toHaveBeenCalledWith('navigateHistory', expect.objectContaining({
      to: expect.stringContaining('StudyInstanceUIDs=4.5.6'),
    }));
  });

  it('updates the context banner but does not navigate on ImagingStudy-close', async () => {
    await deliver(imagingStudyEvent('ImagingStudy-close', { resourceType: 'ImagingStudy', id: 'is-3' }));
    expect(mockRegister).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
    expect(session.getSessionSnapshot().imagingStudyId).toBe('is-3');
  });

  it('ignores events that carry no ImagingStudy context', async () => {
    MockWebSocket.last.serverEvent({
      id: 'p1',
      event: { 'hub.event': 'Patient-open', context: [{ key: 'patient', resource: { resourceType: 'Patient', id: 'p' } }] },
    });
    await flushMicrotasks();
    expect(mockRegister).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('warns via the notification service when the study has no DICOM UID', async () => {
    mockRegister.mockResolvedValue(null); // no urn:dicom:uid identifier
    await deliver(imagingStudyEvent('ImagingStudy-open', { resourceType: 'ImagingStudy', id: 'no-uid' }));
    expect(runCommand).not.toHaveBeenCalled();
    expect(uiNotificationService.show).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warning', title: 'FHIRcast' })
    );
  });

  it('does not reopen the study already on screen (echoed/duplicate event)', async () => {
    mockRegister.mockResolvedValue({ StudyInstanceUID: '1.1.1', patientId: 'pat-1' });
    await deliver(imagingStudyEvent('ImagingStudy-open', { resourceType: 'ImagingStudy', id: 'a' }));
    expect(runCommand).toHaveBeenCalledTimes(1);

    // Same study UID again (distinct event id so it isn't deduped as the same event).
    await deliver(imagingStudyEvent('ImagingStudy-open', { resourceType: 'ImagingStudy', id: 'a' }));
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it('does not navigate once the viewer route is suspended (mode exit)', async () => {
    listener.suspendFhircastContextListener();
    mockRegister.mockResolvedValue({ StudyInstanceUID: '7.7.7', patientId: 'p' });
    await deliver(imagingStudyEvent('ImagingStudy-open', { resourceType: 'ImagingStudy', id: 'is-x' }));
    // Registration still runs, but navigation is held back with no active route.
    expect(mockRegister).toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
  });

  describe('navigation guard (unsaved work / patient change)', () => {
    let uiModalService;

    // Re-register the listener with the services the guard consults; the
    // start call is idempotent for the subscription but refreshes services.
    function useServices({ measurements = [], segmentations = [], modal = true } = {}) {
      uiModalService = modal ? { show: jest.fn(), hide: jest.fn() } : undefined;
      listener.startFhircastContextListener({
        servicesManager: {
          services: {
            uiNotificationService,
            measurementService: { getMeasurements: () => measurements },
            segmentationService: { getSegmentations: () => segmentations },
            ...(uiModalService ? { uiModalService } : {}),
          },
        },
        commandsManager: { runCommand },
      });
    }

    it('asks before navigating when unsaved measurements exist', async () => {
      useServices({ measurements: [{ uid: 'm1' }] });
      mockRegister.mockResolvedValue({ StudyInstanceUID: '5.5.5', patientId: 'pat-1' });
      await deliver(imagingStudyEvent('ImagingStudy-open', { resourceType: 'ImagingStudy', id: 'is-m' }));

      expect(runCommand).not.toHaveBeenCalled();
      expect(uiModalService.show).toHaveBeenCalledTimes(1);
      expect(uiModalService.show.mock.calls[0][0].contentProps).toMatchObject({
        nextStudyUid: '5.5.5',
        unsavedWork: true,
      });
      expect(listener.getPendingFhircastContext()).toMatchObject({ StudyInstanceUID: '5.5.5' });
    });

    it('asks before navigating when the context changes the active patient', async () => {
      window.history.pushState({}, '', '/fhir-viewer?patient=pat-A');
      useServices();
      mockRegister.mockResolvedValue({ StudyInstanceUID: '6.6.6', patientId: 'pat-B' });
      await deliver(imagingStudyEvent('ImagingStudy-open', { resourceType: 'ImagingStudy', id: 'is-p' }));

      expect(runCommand).not.toHaveBeenCalled();
      expect(uiModalService.show).toHaveBeenCalledTimes(1);
      expect(uiModalService.show.mock.calls[0][0].contentProps).toMatchObject({
        currentPatientId: 'pat-A',
        nextPatientId: 'pat-B',
        patientChanges: true,
      });
    });

    it('navigates without asking when there is no unsaved work and the patient is unchanged', async () => {
      window.history.pushState({}, '', '/fhir-viewer?patient=pat-1');
      useServices();
      mockRegister.mockResolvedValue({ StudyInstanceUID: '5.5.5', patientId: 'pat-1' });
      await deliver(imagingStudyEvent('ImagingStudy-open', { resourceType: 'ImagingStudy', id: 'is-c' }));

      expect(uiModalService.show).not.toHaveBeenCalled();
      expect(runCommand).toHaveBeenCalledWith('navigateHistory', expect.objectContaining({
        to: expect.stringContaining('StudyInstanceUIDs=5.5.5'),
      }));
    });

    it('accepting opens the most recent context, not the first deferred one', async () => {
      useServices({ measurements: [{ uid: 'm1' }] });
      mockRegister.mockResolvedValueOnce({ StudyInstanceUID: '1.1.1', patientId: 'pat-1' });
      await deliver(imagingStudyEvent('ImagingStudy-open', { resourceType: 'ImagingStudy', id: 'first' }));
      mockRegister.mockResolvedValueOnce({ StudyInstanceUID: '2.2.2', patientId: 'pat-2' });
      await deliver(imagingStudyEvent('ImagingStudy-open', { resourceType: 'ImagingStudy', id: 'second' }));

      // Accept via the dialog's Open button (same function the panel uses).
      const { onOpen } = uiModalService.show.mock.calls.at(-1)[0].contentProps;
      onOpen();

      expect(runCommand).toHaveBeenCalledTimes(1);
      expect(runCommand).toHaveBeenCalledWith('navigateHistory', expect.objectContaining({
        to: expect.stringContaining('StudyInstanceUIDs=2.2.2'),
      }));
      expect(uiModalService.hide).toHaveBeenCalled();
      expect(listener.getPendingFhircastContext()).toBeNull();
    });

    it('"Not now" dismisses but keeps the context pending for the accept-later path', async () => {
      useServices({ segmentations: [{ id: 's1' }] });
      mockRegister.mockResolvedValue({ StudyInstanceUID: '8.8.8', patientId: 'pat-1' });
      await deliver(imagingStudyEvent('ImagingStudy-open', { resourceType: 'ImagingStudy', id: 'is-d' }));

      const { onCancel } = uiModalService.show.mock.calls[0][0].contentProps;
      onCancel();
      expect(uiModalService.hide).toHaveBeenCalled();
      expect(runCommand).not.toHaveBeenCalled();
      expect(listener.getPendingFhircastContext()).toMatchObject({ StudyInstanceUID: '8.8.8' });

      // Accept later (the panel's Open button) — opens the deferred context.
      listener.openPendingFhircastContext();
      expect(runCommand).toHaveBeenCalledWith('navigateHistory', expect.objectContaining({
        to: expect.stringContaining('StudyInstanceUIDs=8.8.8'),
      }));
      expect(listener.getPendingFhircastContext()).toBeNull();
    });

    it('falls back to navigating when no modal service exists to ask with', async () => {
      useServices({ measurements: [{ uid: 'm1' }], modal: false });
      mockRegister.mockResolvedValue({ StudyInstanceUID: '3.3.3', patientId: 'pat-1' });
      await deliver(imagingStudyEvent('ImagingStudy-open', { resourceType: 'ImagingStudy', id: 'is-f' }));

      expect(runCommand).toHaveBeenCalledWith('navigateHistory', expect.objectContaining({
        to: expect.stringContaining('StudyInstanceUIDs=3.3.3'),
      }));
    });
  });
});
