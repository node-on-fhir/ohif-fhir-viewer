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

test('Edit Request Body opens an Ace editor with the registration JSON', async ({ page }) => {
  await page.goto('/fhir-viewer', { waitUntil: 'domcontentloaded' });

  // Settings gear → Preferences opens the SMART preferences modal. The gear
  // has no stable test id, so probe the menu triggers until the menu
  // containing "Preferences" opens. The trigger set is re-read each pass
  // because the header mounts after domcontentloaded.
  const triggers = page.locator('[aria-haspopup="menu"]');
  const prefsItem = page.getByRole('menuitem', { name: 'Preferences' });
  await triggers.first().waitFor({ state: 'visible', timeout: 60_000 });

  const deadline = Date.now() + 60_000;
  let opened = false;
  while (!opened && Date.now() < deadline) {
    const count = await triggers.count();
    for (let i = count - 1; i >= 0 && !opened; i--) {
      await triggers.nth(i).click().catch(() => {});
      opened = await prefsItem
        .waitFor({ state: 'visible', timeout: 1500 })
        .then(() => true)
        .catch(() => false);
      if (!opened) {
        await page.keyboard.press('Escape');
      }
    }
    if (!opened) {
      await page.waitForTimeout(1000);
    }
  }
  await prefsItem.click();

  await page.getByRole('button', { name: 'Edit Request Body' }).click();

  // Ace loads lazily; its rendered content holds the derived registration body
  const editor = page.locator('.ace_editor');
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('client_name');
  await expect(editor).toContainText('authorization_code');
});
