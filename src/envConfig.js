/**
 * Build-time environment configuration.
 *
 * `process.env.SMART_CLIENT_ID` and `process.env.SMART_FHIR_SERVER_URL` are
 * inlined into the bundle by DefinePlugin entries that `scripts/setup.js`
 * patches into the app's webpack.pwa.js. Values come from the shell
 * (`SMART_CLIENT_ID=... pnpm dev`) or from `Viewers/platform/app/.env`
 * (loaded via dotenv in webpack.pwa.js).
 *
 * If the DefinePlugin patch was applied, each `process.env.*` expression is
 * replaced with a string literal at build time. If it was not applied,
 * `process` is undefined in the browser and the ReferenceError lands in the
 * catch.
 */

export function getEnvSmartClientId() {
  try {
    return process.env.SMART_CLIENT_ID || '';
  } catch (e) {
    return '';
  }
}

export function getEnvFhirServerUrl() {
  try {
    return process.env.SMART_FHIR_SERVER_URL || '';
  } catch (e) {
    return '';
  }
}
