# @ohif/fhir-viewer

Consolidated OHIF viewer extension — custom viewport actions, ECG waveform rendering, FHIR data source, hanging protocols, DICOM ZIP export, and a minimal viewer layout.

<img width="2560" height="1440" alt="Screenshot 2026-04-20 at 3 12 15 AM" src="https://github.com/user-attachments/assets/d36cf187-f401-4bab-b22e-ab8d8cbac517" />


## Quick Start

```bash
# install OHIF
# (until OHIF/Viewers#6143 merges, use the PR branch)
git clone https://github.com/awatson1978/Viewers
cd Viewers
git fetch origin
git checkout cli-tool

# install the extension
cd extensions && git clone https://github.com/node-on-fhir/ohif-fhir-viewer && cd ..

# install dependencies
brew install pnpm
pnpm install
```

Then run the viewer with the extension, using either installation style:

```bash
# 12-factor / env-var (no tracked-file changes)
EXTRA_EXTENSIONS=@ohif/fhir-viewer pnpm dev

# or classic CLI registration, then a plain dev run
pnpm run cli link-extension extensions/ohif-fhir-viewer
pnpm dev
```

In both cases the extension **and** its bundled `fhir-viewer` mode load — the build auto-detects the companion mode in `mode/`, so no separate mode registration is needed. Visit `http://localhost:3000/fhir-viewer` to open the mode.

Note: `link-extension` writes an entry into the tracked `platform/app/pluginConfig.json` — fine for local development, but don't commit it (CI clones of Viewers don't contain this extension). The env-var style leaves the working tree untouched. See [docs/INSTALL-COMPARISON.md](docs/INSTALL-COMPARISON.md) for a full comparison of the installation patterns.

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

The SMART `client_id` used during the OAuth flow defaults to the value in `config/default.js` (`smartClientId`). To override it per-environment without editing `default.js`, add the following to `Viewers/platform/app/.env`:

```
SMART_CLIENT_ID=your-registered-client-id
```

The `.env` value takes priority over the config file. Restart the dev server after changing `.env`.

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
