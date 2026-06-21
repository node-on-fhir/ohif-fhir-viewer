# Node on FHIR — Radiology Information System (RIS) Integration

Step-by-step guide for setting up a Node on FHIR instance as the backend RIS for the NOF OHIF Viewer.

## 1. Run Node on FHIR (Honeycomb Edition)

Install Meteor 3.4, clone the Honeycomb starter, and run it:

```bash
curl https://install.meteor.com?release=3.4 | sh

git clone https://github.com/node-on-fhir/core nof

cd nof

meteor npm install
meteor run

open http://localhost:3000
Ctrl+C
```

## 2. Add USCore, International Patient Summary, Synthea, and Admin Tools

Re-run with extensions via the `EXTRA_WORKFLOWS` environment variable:

```bash
meteor npm install

EXTRA_WORKFLOWS=@node-on-fhir/us-core,@node-on-fhir/international-patient-summary,@node-on-fhir/synthea,@node-on-fhir/admin-tools,@node-on-fhir/data-importer meteor run

open http://localhost:3000
Ctrl+C
```

## 3. Add a Settings File and Port

Same as above, but point Meteor at a settings file with `--settings` and `--port`:

```bash
meteor npm install

EXTRA_WORKFLOWS=@node-on-fhir/us-core,@node-on-fhir/international-patient-summary,@node-on-fhir/synthea,@node-on-fhir/admin-tools,@node-on-fhir/data-importer  meteor run --settings settings/settings.nodeonfhir.localhost.json --port 3200

open http://localhost:3200
Ctrl+C
```

## 4. Add the Radiology Workflow Package

Clone the `radiology-workflow` package into a local `npmPackages/` directory, then run with the `EXTRA_WORKFLOWS` environment variable and the radiology-workflow settings file on port 3200:

```bash
cd extensions
git clone https://github.com/node-on-fhir/radiology-workflow
cd ..

meteor npm install

EXTRA_WORKFLOWS=@node-on-fhir/us-core,@node-on-fhir/international-patient-summary,@node-on-fhir/synthea,@node-on-fhir/admin-tools,@node-on-fhir/data-importer,@node-on-fhir/radiology-workflow meteor run --settings npmPackages/radiology-workflow/settings/settings.ohif.json --extra-packages "clinical:us-core, clinical:international-patient-summary, clinical:synthea, clinical:admin-tools, clinical:data-importer" --port 3200

open http://localhost:3200
Ctrl+C
```

## 5. Register an OAuth Client

The OHIF viewer authenticates against Node on FHIR using SMART on FHIR (OAuth 2.0). You need to register a client so the RIS knows which app is requesting access.

Navigate to `http://localhost:3200/oauth-clients` and click **"+ New Client"**. Fill in the following fields:

| Field | Value |
|---|---|
| **Client Name** | `OHIF FHIR Viewer` |
| **Redirect URIs** | `http://localhost:3200/fhir-viewer` |
| **Scopes** | `launch openid fhirUser patient/*.read` |
| **Grant Types** | `authorization_code` |
| **Response Types** | `code` |
| **Token Endpoint Auth Method** | `client_secret_basic` |

Alternatively, POST the equivalent JSON to the `/oauth/register` endpoint:

```json
{
  "client_name": "OHIF FHIR Viewer",
  "redirect_uris": ["http://localhost:3200/fhir-viewer"],
  "scope": "launch openid fhirUser patient/*.read",
  "grant_types": ["authorization_code"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "client_secret_basic"
}
```

After registration, copy the generated `client_id`. You can supply it to OHIF either as the `smartClientId` field in the data source configuration, or — without editing any tracked files — via the `SMART_CLIENT_ID` environment variable (see step 6), which overrides the data-source value.

## 6. Install and Run the OHIF Viewer

With the RIS running on port 3200, install OHIF alongside the NOF FHIR extension and launch it pointed at the RIS:

```bash
# create a working directory
mkdir demo && cd demo

# install OHIF and the NOF FHIR extension
git clone https://github.com/OHIF/Viewers
cd Viewers/extensions
git clone https://github.com/node-on-fhir/ohif-fhir-viewer
cd ..

# link the workspace packages
yarn install
```

The extension and its bundled `node-on-fhir` mode are injected at startup through the `EXTRA_EXTENSIONS` / `EXTRA_MODES` environment variables — no edits to `pluginConfig.json` are required. Set `SMART_CLIENT_ID` to the `client_id` from step 5, and `FHIR_SERVER` to the RIS you started above:

```bash
EXTRA_EXTENSIONS=@ohif/extension-nof-ohif-viewer EXTRA_MODES=node-on-fhir SMART_CLIENT_ID=<client_id_from_step_5> FHIR_SERVER=http://localhost:3200 yarn dev
```

> **Note on the mode path:** the `node-on-fhir` mode ships nested inside the extension at `extensions/ohif-fhir-viewer/mode`, so it isn't a top-level workspace package. The `=<directory>` suffix points `EXTRA_MODES` straight at it. (Alternatively, copy that folder to `modes/node-on-fhir` and use the bare `EXTRA_MODES=node-on-fhir`.)
>
> **Note on `FHIR_SERVER`:** the `/fhir-proxy` dev-server route defaults to `http://localhost:3100`. Because this guide runs the RIS on `3200`, `FHIR_SERVER` must be set to match — otherwise OHIF proxies FHIR requests to the wrong port.

OHIF starts on `http://localhost:3000` by default (override with `OHIF_PORT`). Open the viewer, register it as a SMART client from the Preferences page if you haven't already, then complete the SMART launch from the RIS reading worklist.
