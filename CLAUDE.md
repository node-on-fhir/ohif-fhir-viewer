# CLAUDE.md — @ohif/fhir-viewer

## Project Overview

This is a consolidated OHIF Viewer extension that provides custom viewport commands, ECG waveform rendering, a FHIR R4 data source, hanging protocols, panels, and a minimal layout template. It lives at `Viewers/extensions/ohif-viewer/` inside the OHIF monorepo.

The extension ships with a companion mode (`fhir-viewer`) bundled in the `mode/` directory.

## Setup

```bash
node scripts/setup.js   # copies mode + patches pluginConfig.json
cd ../..                 # back to Viewers root
yarn install             # link workspace packages
yarn dev                 # start dev server
```

## Manual Setup (fallback)

If the setup script doesn't work, do it by hand:

1. Copy `extensions/ohif-viewer/mode/` → `modes/fhir-viewer/`
2. Edit `platform/app/pluginConfig.json`:
   - Add to `extensions` array: `{ "packageName": "@ohif/fhir-viewer", "version": "0.0.1" }`
   - Add to `modes` array: `{ "packageName": "fhir-viewer" }`
3. Run `yarn install` from Viewers root

## Key Identifiers

| What | Value |
|---|---|
| Extension package name | `@ohif/fhir-viewer` |
| Extension ID | read from `package.json` name field via `src/id.js` |
| Mode package name | `fhir-viewer` |
| Mode route | `/fhir-viewer` |
| Command prefix | `nof.` (e.g. `nof.logViewportData`) |
| Toolbar button prefix | `nof-ohif-viewer.` |

## Architecture Notes

- **Entry point**: `src/index.tsx` — default export is the extension object with `preRegistration`, `onModeEnter`, and 8 `get*Module` methods
- **ID derivation**: `src/id.js` reads `name` from `package.json`; also exports `SOPClassHandlerId`
- **Commands**: `src/commandsModule.ts` — defines actions and command definitions keyed by `nof.*` names
- **ECG viewport**: `src/viewports/EcgViewport.tsx` — lazy-loaded React component using `dcmjs-ecg`
- **SOP class handler**: `src/getSopClassHandlerModule.js` — maps 7 ECG SOP class UIDs to a display set builder
- **FHIR data source**: `src/FhirDataSource/` — `fhirClient.js` (API calls), `fhirToOhif.js` (resource mapping), `smartAuth.js` (SMART on FHIR), `dicomLoader.js` (instance fetching)
- **Hanging protocols**: `src/hps/chestBodyPart.ts`
- **Panels**: `src/Panels/FhirConfigPanel.tsx`
- **Layout**: `src/MinimalViewerLayout.tsx`
- **Toolbar buttons**: `src/toolbarButtons.ts` — defines buttons registered in `onModeEnter`
- **Customizations**: `src/getCustomizationModule.ts` — right-click context menu

The companion mode at `mode/src/index.tsx` wires everything together: it imports from `@ohif/mode-longitudinal` for base tool groups and toolbar buttons, then overlays custom toolbar sections and registers the extension's ECG viewport/SOP handler.

## FHIR Proxy

The webpack dev server proxies `/fhir-proxy` requests to an upstream FHIR server, avoiding CORS issues during development.

**How it works**: The proxy entry in `Viewers/platform/app/.webpack/webpack.pwa.js` (lines 161–166) forwards any request to `/fhir-proxy/*` to the target server, stripping the `/fhir-proxy` prefix:

```js
{
  context: ['/fhir-proxy'],
  target: 'http://localhost:3200',
  changeOrigin: true,
  pathRewrite: { '^/fhir-proxy': '' },
}
```

**Automatic URL rewriting**: The FhirDataSource (`src/FhirDataSource/index.js`) detects when the FHIR server origin differs from the app origin and rewrites `_config.fhirBaseUrl` / `_config.fhirServerRoot` to use `/fhir-proxy` (lines 243–250, 346–353).

**Default FHIR config** (in `_config`):
- `fhirBaseUrl`: `http://localhost:3000/baseR4`
- `fhirServerRoot`: `http://localhost:3000`

**Env var overrides** (in `webpack.pwa.js`):
- `PROXY_TARGET` / `PROXY_DOMAIN` — adds an additional proxy entry when both are set
- `PROXY_PATH_REWRITE_FROM` / `PROXY_PATH_REWRITE_TO` — custom path rewrite rules for that entry

**Setup**: `scripts/setup.js` patches the webpack config to ensure the `/fhir-proxy` proxy entry exists. Set `FHIR_PROXY_TARGET` env var at setup time to override the default target (`http://localhost:3200`).

## Common Tasks

**Add a new command**
1. Add an action function in `src/commandsModule.ts` under `actions`
2. Add a definition entry in `definitions` with key `nof.<commandName>`
3. If it needs a toolbar button, add it in `src/toolbarButtons.ts`
4. Register the button in the mode's `onModeEnter` toolbar sections

**Add a new panel**
1. Create a React component in `src/Panels/`
2. Return it from `src/getPanelModule.tsx` with a `name` key
3. Reference it in the mode's route layout template (`mode/src/index.tsx`)

**Add a new hanging protocol**
1. Create the protocol object in `src/hps/`
2. Add it to the array returned by `src/getHangingProtocolModule.ts`
3. Reference the protocol name in the mode's `hangingProtocol` array

**Add a new SOP class handler**
1. Add the SOP class UID(s) to `src/getSopClassHandlerModule.js`
2. If it needs a custom viewport, create one in `src/viewports/` and register it in `src/index.tsx`
