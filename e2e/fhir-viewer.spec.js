const { test, expect } = require('@playwright/test');

// Minimal smoke test: the fhir-viewer mode route loads in a real browser.
// Assumes an OHIF dev server with this extension linked is already running
// (e2e/run-e2e.sh handles install + boot per the README Quick Start).
test('the /fhir-viewer mode route loads', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/fhir-viewer', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(/OHIF/);

  // The app rendered something into the React root
  await expect(page.locator('#root > *').first()).toBeAttached();

  // OHIF renders "Error (404)" (routes/NotFound) when a mode route is not
  // registered — its absence proves the fhir-viewer mode actually loaded
  await expect(page.locator('body')).not.toContainText('Error (404)');

  // A broken bundle or a crash inside the mode surfaces as an uncaught
  // exception; network/FHIR failures are caught by the app and do not
  expect(pageErrors).toEqual([]);
});

// The FHIR config panel is the first right-panel tab and opens by default, so
// asserting on it would pass trivially — fhircast proves an actual tab switch.
test('?panel=fhircast activates the FHIRcast panel', async ({ page }) => {
  await page.goto('/fhir-viewer?panel=fhircast', { waitUntil: 'domcontentloaded' });

  // "Subscribe to Events" is a section header unique to FhirCastPanel
  await expect(page.getByText('Subscribe to Events')).toBeVisible();
});
