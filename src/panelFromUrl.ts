import { id } from './id.js';

const PANEL_IDS = {
  'fhir-connection': `${id}.panelModule.fhirConfig`,
  fhircast: `${id}.panelModule.fhirCast`,
  measurements: '@ohif/extension-cornerstone.panelModule.panelMeasurement',
};

export function getPanelIdFromSearch(search: string): string | null {
  const panel = new URLSearchParams(search).get('panel');
  if (!panel) {
    return null;
  }
  const panelId = PANEL_IDS[panel.toLowerCase()];
  if (!panelId) {
    console.warn(
      `[FHIR] Unknown ?panel= value "${panel}". Valid values: ${Object.keys(PANEL_IDS).join(', ')}`
    );
    return null;
  }
  return panelId;
}

// ACTIVATE_PANEL is only heard once SidePanelWithServices has mounted and
// subscribed, which happens shortly after onModeEnter — retry across that gap.
// Activation is idempotent; capped at 1s so a user switching tabs right away
// isn't yanked back later.
const RETRY_DELAYS_MS = [0, 300, 1000];

// Last ?panel= value acted on — see the doc comment on activatePanelFromUrl.
let lastActivatedPanelParam: string | null = null;

/**
 * Open the side panel a `?panel=` URL param asks for.
 *
 * `?panel=` is a launch intent — "come up showing this panel" — not a standing
 * instruction to keep it open. onModeEnter runs on every mode entry, and a
 * FHIRcast context switch navigates while preserving the query string, so the
 * param used to ride along and re-fire activatePanel on each hop: close the
 * panel, let an ImagingStudy-open arrive, and it forced itself back open.
 * Acting only when the value changes leaves the panel however the user last
 * left it while still honouring a genuinely new request; a full page load
 * resets the latch, so a fresh launch URL always activates.
 */
export function activatePanelFromUrl(servicesManager): void {
  let panelId = getPanelIdFromSearch(window.location.search);

  if (!panelId) {
    // A SMART OAuth redirect strips the query string; the original params were
    // saved to sessionStorage by saveAuthState before redirecting away.
    try {
      const authState = JSON.parse(sessionStorage.getItem('fhir_smart_auth_state') || 'null');
      const saved = authState?.urlParams?.panel;
      if (saved) {
        panelId = getPanelIdFromSearch(`?panel=${encodeURIComponent(saved)}`);
      }
    } catch (e) {
      /* ignore parse errors */
    }
  }

  if (!panelId) {
    return;
  }

  if (panelId === lastActivatedPanelParam) {
    return;
  }
  lastActivatedPanelParam = panelId;

  const { panelService } = servicesManager.services;
  if (!panelService) {
    return;
  }

  RETRY_DELAYS_MS.forEach(ms => {
    setTimeout(() => panelService.activatePanel(panelId, true), ms);
  });
}
