/**
 * @jest-environment jsdom
 */
/**
 * Tests for activatePanelFromUrl (panelFromUrl.ts).
 *
 * The PR made panel activation fire only when the resolved panel id changes,
 * so a FHIRcast context switch — which navigates while preserving ?panel= —
 * no longer forces a panel the user has since closed back open. These tests
 * pin that dedup behavior and the SMART-redirect fallback.
 */
function setSearch(search) {
  // jsdom lets us rewrite the query string without a navigation.
  window.history.replaceState({}, '', `/fhir-viewer${search}`);
}

function loadModule() {
  let mod;
  jest.isolateModules(() => {
    mod = require('../panelFromUrl');
  });
  return mod;
}

function makeServices() {
  const activatePanel = jest.fn();
  const servicesManager = { services: { panelService: { activatePanel } } };
  return { servicesManager, activatePanel };
}

describe('activatePanelFromUrl', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    sessionStorage.clear();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('activates the panel named by ?panel=, with retries, forcing it active', () => {
    const { activatePanelFromUrl } = loadModule();
    const { servicesManager, activatePanel } = makeServices();
    setSearch('?panel=fhircast');

    activatePanelFromUrl(servicesManager);
    jest.runAllTimers();

    expect(activatePanel).toHaveBeenCalledWith('@ohif/fhir-viewer.panelModule.fhirCast', true);
    // Retries across the SidePanel mount gap (RETRY_DELAYS_MS has three entries).
    expect(activatePanel).toHaveBeenCalledTimes(3);
  });

  it('does not re-activate when called again with the same panel param (context-switch hop)', () => {
    const { activatePanelFromUrl } = loadModule();
    const { servicesManager, activatePanel } = makeServices();
    setSearch('?panel=fhircast');

    activatePanelFromUrl(servicesManager);
    jest.runAllTimers();
    activatePanel.mockClear();

    // onModeEnter fires again on a FHIRcast-driven navigation; the param rode along.
    activatePanelFromUrl(servicesManager);
    jest.runAllTimers();

    expect(activatePanel).not.toHaveBeenCalled();
  });

  it('activates again when the panel param changes to a new value', () => {
    const { activatePanelFromUrl } = loadModule();
    const { servicesManager, activatePanel } = makeServices();

    setSearch('?panel=fhircast');
    activatePanelFromUrl(servicesManager);
    jest.runAllTimers();
    activatePanel.mockClear();

    setSearch('?panel=fhir-connection');
    activatePanelFromUrl(servicesManager);
    jest.runAllTimers();

    expect(activatePanel).toHaveBeenCalledWith('@ohif/fhir-viewer.panelModule.fhirConfig', true);
  });

  it('does nothing when there is no panel param and no saved SMART state', () => {
    const { activatePanelFromUrl } = loadModule();
    const { servicesManager, activatePanel } = makeServices();
    setSearch('');

    activatePanelFromUrl(servicesManager);
    jest.runAllTimers();

    expect(activatePanel).not.toHaveBeenCalled();
  });

  it('falls back to the panel saved in SMART auth state after an OAuth redirect', () => {
    const { activatePanelFromUrl } = loadModule();
    const { servicesManager, activatePanel } = makeServices();
    setSearch('?code=abc&state=xyz'); // OAuth callback, panel param stripped
    sessionStorage.setItem(
      'fhir_smart_auth_state',
      JSON.stringify({ urlParams: { panel: 'fhircast' } })
    );

    activatePanelFromUrl(servicesManager);
    jest.runAllTimers();

    expect(activatePanel).toHaveBeenCalledWith('@ohif/fhir-viewer.panelModule.fhirCast', true);
  });
});
