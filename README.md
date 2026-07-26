# @ohif/fhir-viewer

Consolidated OHIF viewer extension — custom viewport actions, ECG waveform rendering, FHIR data source, hanging protocols, DICOM ZIP export, and a minimal viewer layout.

<img width="2560" height="1440" alt="Screenshot 2026-04-20 at 3 12 15 AM" src="https://github.com/user-attachments/assets/d36cf187-f401-4bab-b22e-ab8d8cbac517" />


## Quick Start

Clone the extension and OHIF **side by side**, install each, then link with the OHIF CLI:

```bash
# the extension — install its own dependencies
git clone https://github.com/node-on-fhir/ohif-fhir-viewer
cd ohif-fhir-viewer
pnpm install --config.auto-install-peers=false
cd ..

# OHIF
git clone https://github.com/OHIF/Viewers
cd Viewers
brew install pnpm   # if you don't already have pnpm
pnpm install

# link the extension and its companion mode, then run
pnpm run cli link-extension ../ohif-fhir-viewer
pnpm run cli link-mode ../ohif-fhir-viewer/mode
pnpm dev
```

Open `http://localhost:3000/fhir-viewer`.

Notes:

- `--config.auto-install-peers=false` matters: the extension's `peerDependencies` (e.g. `@ohif/core`) resolve from the OHIF build at bundle time and must not be installed into the extension's own `node_modules`.
- The `link-*` commands write entries into OHIF's tracked `platform/app/pluginConfig.json` — fine for local development, but don't commit them (clones of Viewers don't contain this extension). `unlink-extension` / `unlink-mode` undo them.

### Alternative: env-var injection (requires [OHIF/Viewers#6143](https://github.com/OHIF/Viewers/pull/6143))

With that PR's branch, a single environment variable replaces both `link-*` commands and leaves the Viewers working tree untouched — the bundled `fhir-viewer` mode is auto-detected:

```bash
# out-of-tree checkout (use an absolute path for the directory override)
EXTRA_EXTENSIONS="@ohif/fhir-viewer=$PWD/../ohif-fhir-viewer" pnpm dev

# or, if the extension is cloned inside extensions/, the name alone suffices
EXTRA_EXTENSIONS=@ohif/fhir-viewer pnpm dev
```

See [docs/INSTALL-COMPARISON.md](docs/INSTALL-COMPARISON.md) for a full comparison of the installation patterns.

## Features

**Commands**
- `nof.logViewportData` — logs full viewport state (camera, display sets, tools, measurements, performance) to the console
- `nof.inspectViewportState` — opens a modal with viewport properties, actors, and image data
- `nof.textCallback` — text annotation input dialog (used by the Text tool)
- `downloadDicomZip` — exports the current study as a ZIP of DICOM Part 10 files (WADO-RS, WADO-URI, and blob URL strategies)

**ECG Waveform Viewport**
Renders DICOM ECG waveforms using `dcmjs-ecg`. Handles 7 SOP classes:
- 12-Lead ECG (`1.2.840.10008.5.1.4.1.1.9.1.1`)
- General ECG (`1.2.840.10008.5.1.4.1.1.9.1.2`)
- Ambulatory ECG (`1.2.840.10008.5.1.4.1.1.9.1.3`)
- Hemodynamic Waveform (`1.2.840.10008.5.1.4.1.1.9.2.1`)
- Basic Cardiac EP (`1.2.840.10008.5.1.4.1.1.9.3.1`)
- Arterial Pulse Waveform (`1.2.840.10008.5.1.4.1.1.9.5.1`)
- Respiratory Waveform (`1.2.840.10008.5.1.4.1.1.9.6.1`)

**FHIR Data Source**
A `webApi` data source that connects to FHIR R4 servers with SMART on FHIR auth, translating ImagingStudy and DocumentReference resources into OHIF-compatible study/series/instance metadata.

### SMART on FHIR Configuration

The SMART `client_id` and FHIR server URL resolve in this order (highest first):

1. `SMART_CLIENT_ID` / `SMART_FHIR_SERVER_URL` environment variables (inlined at build time)
2. Values saved from the SMART Preferences modal (localStorage)
3. `smartClientId` in the OHIF data-source configuration

**Registering a client**

Open User Preferences → SMART on FHIR, enter the FHIR Server URL, and click **Register**. The server's dynamic registration endpoint returns a `client_id`, which is filled into the Client ID field automatically.

**Persisting the Client ID via environment variable**

The registered `client_id` lives in localStorage until you persist it. To make it survive across browsers and rebuilds, restart the dev server with the environment variable set:

```bash
SMART_CLIENT_ID=your-registered-client-id pnpm dev
```

or add it (and optionally the server URL) to `Viewers/platform/app/.env`:

```
SMART_CLIENT_ID=your-registered-client-id
SMART_FHIR_SERVER_URL=http://localhost:3100/baseR4
```

Notes:

- `node scripts/setup.js` must have been run — it patches a `DefinePlugin` entry into `webpack.pwa.js` that inlines both variables into the bundle. Without the patch the variables are silently ignored.
- The values are inlined **at build time**, so changing them always requires a dev-server restart.
- When an environment variable is set, the corresponding field in the SMART Preferences modal is filled in and locked, and Register is disabled (a new registration could not overwrite the inlined value).

**Hanging Protocols**
- `chestBodyPart` — body-part-aware protocol for chest imaging

**Panels**
- `fhirConfig` — configuration panel for FHIR server URL, auth, and connection testing

**Layout Templates**
- `minimalViewerLayout` — a streamlined viewer layout

**Customizations**
- `viewportContextMenu` — right-click context menu with DICOM ZIP export

## Module Reference

| Module Type | OHIF ID | Description |
|---|---|---|
| `commandsModule` | `nof.logViewportData`, `nof.inspectViewportState`, `nof.textCallback`, `downloadDicomZip` | Viewport logging, state inspector, text input, DICOM export |
| `viewportModule` | `ecg-dicom` | ECG waveform viewport |
| `sopClassHandlerModule` | `ecg-dicom` | Display set builder for ECG SOP classes |
| `dataSourcesModule` | `fhir` | FHIR R4 data source |
| `panelModule` | `fhirConfig` | FHIR configuration panel |
| `hangingProtocolModule` | `chestBodyPart` | Chest body-part hanging protocol |
| `layoutTemplateModule` | `minimalViewerLayout` | Minimal viewer layout |
| `customizationModule` | `viewportContextMenu` | Right-click context menu |

## Companion Mode

The `fhir-viewer` mode (bundled in `mode/`) provides a standard OHIF layout configured for this extension. It:

- Registers the ECG viewport and SOP class handler alongside the default Cornerstone viewport
- Adds the FHIR config panel to the right panel group
- Configures toolbar sections with measurement tools, viewport actions, and the log/inspect buttons
- Sets up right-click context menus with DICOM export
- Extends the default tool group with a Text annotation tool

Route: `/fhir-viewer`

## Dependencies

- **jszip** `^3.10.1` — ZIP archive generation for DICOM export
- **dcmjs-ecg** `^0.0.14` — DICOM ECG waveform parsing and rendering

## License

MIT / Apache 2.0
