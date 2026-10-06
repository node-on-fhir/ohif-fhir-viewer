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
});
