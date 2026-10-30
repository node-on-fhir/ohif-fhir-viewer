import { getSessionSnapshot, setImagingStudyContext, subscribeToSession } from './fhircastSession';
import { registerImagingStudyContext } from '../../FhirDataSource';
import FhircastNavigationConfirm from './FhircastNavigationConfirm';

/**
 * Acts on FHIRcast context events, from module scope rather than from the panel.
 *
 * The socket already outlives the panel (see fhircastSession), but reacting to
 * what arrives on it used to live in a `useEffect` inside FhirCastPanel — so
 * events kept being received while the FHIRcast tab was not the active one, and
 * nothing opened the study they named. Selecting any other side-panel tab, or
 * collapsing the panel, silently stopped the viewer following context.
 *
 * Registered from the extension's onModeEnter, so it is listening for as long as
 * the viewer is up regardless of which tab is on screen. Navigation goes through
 * the `navigateHistory` command rather than useNavigate, since there is no
 * component here — OHIF backs that with a module-level history.navigate.
 */

interface StartArgs {
  servicesManager: AppTypes.ServicesManager;
  commandsManager: AppTypes.CommandsManager;
}

let started = false;
let services: StartArgs['servicesManager'] | null = null;
let commands: StartArgs['commandsManager'] | null = null;
let unsubscribe: (() => void) | null = null;

// Newest event already handled, so a re-render or a reconnect replaying state
// does not reopen the same study.
let lastHandledEventId = '';
// Study currently on screen by our doing, so a repeated or echoed event for the
// study already open is a no-op rather than a redundant navigation.
let openedStudyUid = '';
// Captured on mode entry: the route to navigate within. Only set while a mode is
// active, so an event arriving from the study list does not try to route into a
// viewer that is not there.
let viewerPathname = '';
// The newest context the user has not acted on yet. Set when navigation is
// gated behind the confirm dialog; a newer gated event overwrites it, so
// accepting always opens the most recent context, not the first deferred one.
let pendingContext: { StudyInstanceUID: string; patientId: string } | null = null;

function extractStudyContext(event: Record<string, unknown> | undefined) {
  if (!event) {
    return null;
  }
  const contexts = event['context'];
  if (!Array.isArray(contexts)) {
    return null;
  }

  // `*-close` withdraws context. Everything else that carries a study —
  // ImagingStudy-open/update/select, and DiagnosticReport-open, which per the
  // FHIRcast IG carries the study it reports on — puts one in focus.
  const eventName = String(event['hub.event'] || '');
  const opensStudy = eventName !== '' && !eventName.endsWith('-close');

  for (const ctx of contexts) {
    if (ctx?.resource?.resourceType === 'ImagingStudy') {
      return { study: ctx.resource as Record<string, unknown>, opensStudy };
    }
  }
  return null;
}

async function openStudyFromContext(resource: Record<string, unknown>): Promise<void> {
  let registered: { StudyInstanceUID: string; patientId: string } | null = null;
  try {
    registered = await registerImagingStudyContext(resource);
  } catch (err) {
    console.error('[FhirCast] Could not register the ImagingStudy in context:', err);
  }

  const StudyInstanceUID = registered?.StudyInstanceUID;
  if (!StudyInstanceUID) {
    services?.services?.uiNotificationService?.show({
      title: 'FHIRcast',
      message:
        'The event named an ImagingStudy with no DICOM study UID, so there is nothing to open. ' +
        'The resource needs an identifier of system urn:dicom:uid.',
      type: 'warning',
      duration: 8000,
    });
    return;
  }

  if (openedStudyUid === StudyInstanceUID) {
    return;
  }

  if (!viewerPathname) {
    console.warn(
      '[FhirCast] Context named study',
      StudyInstanceUID,
      'but no viewer route is active — not navigating'
    );
    return;
  }

  const patientId = registered?.patientId || '';

  // Navigating is a full mode exit/entry in OHIF: segmentationService.destroy()
  // and MeasurementService.onModeExit() clear unsaved work with no prompt of
  // their own. When any exists, or the context moves to another patient, the
  // user confirms first. ACK already went out on receipt, so deferring here
  // cannot cause a FHIRcast SyncError.
  const currentPatientId = new URLSearchParams(window.location.search).get('patient') || '';
  const patientChanges = !!(patientId && currentPatientId && patientId !== currentPatientId);
  if (!patientChanges && !hasUnsavedWork()) {
    navigateToStudy(StudyInstanceUID, patientId);
    return;
  }

  pendingContext = { StudyInstanceUID, patientId };
  showNavigationConfirm(patientChanges);
}

function hasUnsavedWork(): boolean {
  const svc = services?.services;
  const measurements = svc?.measurementService?.getMeasurements?.() || [];
  const segmentations = svc?.segmentationService?.getSegmentations?.() || [];
  return measurements.length > 0 || segmentations.length > 0;
}

function navigateToStudy(StudyInstanceUID: string, patientId: string): void {
  openedStudyUid = StudyInstanceUID;
  pendingContext = null;

  // Keep every other param (iss, launch, patient, ...) and the route captured on
  // mode entry, which already names the mode and the data source.
  const query = new URLSearchParams(window.location.search);
  query.set('StudyInstanceUIDs', StudyInstanceUID);
  if (patientId) {
    // The data source re-reads this on every route change and lists the
    // patient's studies from it, so it has to move with the context.
    query.set('patient', patientId);
  }

  console.log('[FhirCast] Opening study from context:', StudyInstanceUID);
  commands?.runCommand('navigateHistory', { to: `${viewerPathname}?${query.toString()}` });
}

function showNavigationConfirm(patientChanges: boolean): void {
  const uiModalService = services?.services?.uiModalService;
  if (!uiModalService?.show || !pendingContext) {
    // No modal service to ask with (e.g. a headless deployment): keep the
    // pre-dialog behavior of following context rather than silently dropping it.
    if (pendingContext) {
      navigateToStudy(pendingContext.StudyInstanceUID, pendingContext.patientId);
    }
    return;
  }

  const query = new URLSearchParams(window.location.search);
  uiModalService.show({
    title: 'FHIRcast — open study from context?',
    content: FhircastNavigationConfirm,
    contentProps: {
      currentStudyUid: query.get('StudyInstanceUIDs') || '',
      currentPatientId: query.get('patient') || '',
      nextStudyUid: pendingContext.StudyInstanceUID,
      nextPatientId: pendingContext.patientId,
      unsavedWork: hasUnsavedWork(),
      patientChanges,
      onOpen: () => openPendingFhircastContext(),
      // "Not now" only dismisses — the context stays pending so the panel's
      // Open button (the accept-later path) can still act on it.
      onCancel: () => uiModalService.hide?.(),
    },
  });
}

/** The context waiting on user confirmation, if any (newest wins). */
export function getPendingFhircastContext(): { StudyInstanceUID: string; patientId: string } | null {
  return pendingContext;
}

/** Open the most recent deferred context — the dialog's Open button and the panel's. */
export function openPendingFhircastContext(): void {
  services?.services?.uiModalService?.hide?.();
  if (!pendingContext || !viewerPathname) {
    return;
  }
  navigateToStudy(pendingContext.StudyInstanceUID, pendingContext.patientId);
}

function handleLatestEvent(): void {
  const { receivedEvents } = getSessionSnapshot();
  const latest = receivedEvents[0];
  if (!latest || latest.id === lastHandledEventId) {
    return;
  }
  lastHandledEventId = latest.id;

  const context = extractStudyContext(latest.event as Record<string, unknown>);
  if (!context) {
    return;
  }

  const { study, opensStudy } = context;
  // Recorded on the session, not in panel state: the panel unmounts on a tab
  // switch, and the context banner should still be right when it comes back.
  setImagingStudyContext({
    imagingStudyId: (study.id as string) || '',
    imagingStudyStatus: (study.status as string) || 'unknown',
  });

  if (opensStudy) {
    void openStudyFromContext(study);
  }
}

/** Idempotent: onModeEnter fires on every mode entry, this should only wire up once. */
export function startFhircastContextListener({ servicesManager, commandsManager }: StartArgs): void {
  services = servicesManager;
  commands = commandsManager;
  viewerPathname = window.location.pathname;

  if (started) {
    return;
  }
  started = true;
  unsubscribe = subscribeToSession(handleLatestEvent);
  console.log('[FhirCast] Context listener active (independent of the panel)');
}

/** Called on mode exit: stop routing into a viewer that is no longer mounted. */
export function suspendFhircastContextListener(): void {
  viewerPathname = '';
  // The study on screen is going away, so the next event for it is a real open.
  openedStudyUid = '';
}

export function stopFhircastContextListener(): void {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
  pendingContext = null;
  suspendFhircastContextListener();
}
