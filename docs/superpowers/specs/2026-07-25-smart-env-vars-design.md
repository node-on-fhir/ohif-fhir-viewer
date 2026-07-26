# SMART_CLIENT_ID / SMART_FHIR_SERVER_URL environment variables

Date: 2026-07-25
Status: approved (implemented same day)

## Problem

After registering an OAuth client from the SMART Preferences modal, the
received `client_id` lives only in localStorage. Users want to persist it via
`SMART_CLIENT_ID=<id> pnpm dev` or `platform/app/.env`, without editing the
main OHIF app. The README previously documented this behavior, but no plumbing
existed: OHIF's webpack `DefinePlugin` inlines a fixed allowlist of
`process.env.*` keys, so extension code cannot read arbitrary env vars.

## Design

Two env vars, same treatment: `SMART_CLIENT_ID` and `SMART_FHIR_SERVER_URL`.

1. **`scripts/setup.js` → `patchWebpackEnv()`** — idempotently inserts a
   `rspack.DefinePlugin` block before `return mergedConfig;` in
   `webpack.pwa.js`, inlining both vars (empty string when unset). Follows the
   existing `patchWebpackProxy()` pattern; no manual upstream edits.
   `dotenv.config()` already runs in `webpack.pwa.js`, so `platform/app/.env`
   feeds the build process.
2. **`src/envConfig.js`** — `getEnvSmartClientId()` / `getEnvFhirServerUrl()`,
   each wrapped in try/catch so an unpatched build returns `''` instead of
   throwing `process is not defined`.
3. **`src/FhirDataSource/index.js`** — precedence becomes
   **env > localStorage > dataSourceConfig**; `clientIdSource: 'environment'`
   in the init log.
4. **`SmartPreferencesModal.tsx`** — env-provided values prefill and disable
   their inputs with a "Set by the … environment variable" note; Register is
   disabled while `SMART_CLIENT_ID` is set. After a successful registration,
   instructions show the actual received ID in both forms
   (`SMART_CLIENT_ID=<id> pnpm dev` and the `.env` line) with a restart note.
5. **README** — rewrote the stale "SMART on FHIR Configuration" section:
   resolution order, register flow, both persistence forms, setup.js
   requirement, build-time/restart caveat.
6. **setup.js layout fix** (found during implementation) — `VIEWERS_ROOT` now
   resolves via candidates (`../..`, `../Viewers`, `$VIEWERS_ROOT`) validated
   by `platform/app/pluginConfig.json`, and `copyMode()` skips when the mode
   is provided by a pnpm `link:` entry (copying would duplicate the package).

## Decisions

- Env wins over localStorage because the UI locks the field — a lower
  precedence would show a locked value that isn't the one in effect.
- Register is disabled (not hidden) when `SMART_CLIENT_ID` is set, with the
  reason shown under the Client ID field.
- Values are inlined at build time; every change requires a dev-server
  restart. Surfaced in both the modal instructions and README.

## Testing

- `src/__tests__/envConfig.test.js` — set/unset/empty for both getters.
- Manual: setup.js idempotence (second run all `[skip]`), patched
  `webpack.pwa.js` loads via `require()`.
