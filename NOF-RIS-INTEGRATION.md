# Node on FHIR — RIS Integration

Step-by-step guide for setting up a Node on FHIR instance as the backend RIS for the  OHIF FHIR Viewer.


## 1. Install and Run the OHIF Viewer
Begin by installing the OHIF Viewer

```bash
# create a working directory
mkdir demo && cd demo

# install OHIF and the NOF FHIR extension
#git clone https://github.com/OHIF/Viewers

git clone https://github.com/awatson1978/Viewers
cd Viewers
git checkout -b fhircast-mvd
git pull origin fhircast-mvd

# install dependencies and run the app
brew install pnpm
pnpm install
pnpm dev
```

The FHIRcast extension is injected at startup through the `EXTRA_EXTENSIONS`
environment variable — no edits to `pluginConfig.json` are required. Its bundled
`fhir-viewer` mode (at `extensions/ohif-fhir-viewer/mode`) is **auto-detected** and
registered alongside it, so no `EXTRA_MODES` entry is needed. `EXTRA_EXTENSIONS` is
a genuine **build/dev-server** variable (read by the Node-based dev server), unlike
the FHIR client ID and server URL, which are runtime config:

```bash
# install the extension
cd extensions
git clone https://github.com/node-on-fhir/ohif-fhir-viewer
cd ..

# install dependencies and run the app
pnpm install
EXTRA_EXTENSIONS=@ohif/extension-nof-ohif-viewer pnpm dev
```

> **Mode auto-detection:** when an `EXTRA_EXTENSIONS` package contains a `mode/`
> subdirectory with a `package.json`, that mode is registered automatically. To
> override or add other modes explicitly, use `EXTRA_MODES` (a comma-separated list
> of `<name>` or `<name>=<directory>` entries).

OHIF starts on `http://localhost:3000` by default (override with `OHIF_PORT`). 


## 2. Install and Run the Node on FHIR Radiology System (RIS)

### A. Run Node on FHIR (Honeycomb Edition)

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

### B. Add USCore, International Patient Summary, Synthea, and Admin Tools

Re-run with extensions via the `EXTRA_WORKFLOWS` environment variable:

```bash
meteor npm install

EXTRA_WORKFLOWS=@node-on-fhir/us-core,@node-on-fhir/international-patient-summary,@node-on-fhir/synthea,@node-on-fhir/admin-tools,@node-on-fhir/data-importer meteor run

open http://localhost:3000
Ctrl+C
```

### C. Add a Settings File and Port

Same as above, but point Meteor at a settings file with `--settings` and `--port`:

```bash
meteor npm install

EXTRA_WORKFLOWS=@node-on-fhir/us-core,@node-on-fhir/international-patient-summary,@node-on-fhir/synthea,@node-on-fhir/admin-tools,@node-on-fhir/data-importer  meteor run --settings settings/settings.nodeonfhir.localhost.json --port 3200

open http://localhost:3200
Ctrl+C
```

### D. Add the Radiology Workflow Package

Clone the `radiology-workflow` package into a local `npmPackages/` directory, then run with the `EXTRA_WORKFLOWS` environment variable and the radiology-workflow settings file on port 3200:

```bash
cd extensions
git clone https://github.com/node-on-fhir/radiology-workflow
cd ..

meteor npm install

EXTRA_WORKFLOWS=@node-on-fhir/us-core,@node-on-fhir/international-patient-summary,@node-on-fhir/synthea,@node-on-fhir/admin-tools,@node-on-fhir/data-importer,@node-on-fhir/radiology-workflow meteor run --settings npmPackages/radiology-workflow/settings/settings.ohif.json --extra-packages "clinical:us-core, clinical:international-patient-summary, clinical:synthea, clinical:admin-tools, clinical:data-importer" CORS=http://localhost:3000 --port 3200

open http://localhost:3200
Ctrl+C
```

### E. Register an OAuth Client

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

After registration, copy the generated `client_id`. OHIF reads it at **runtime** from one of three browser-native surfaces, in most-specific-wins order:

1. **URL** — `?client_id=…` on the SMART launch (per-launch; lets one deployment face multiple registrations).
2. **SMART Preferences panel** — entered/registered in OHIF, saved to `localStorage` (per-user).
3. **`window.config`** — the `smartClientId` field in the data source `configuration` of the served `app-config.js` (per-deployment).

There is **no build-time environment variable** — OHIF is a static SPA, so the client ID must arrive at runtime through one of the above. (For containerized deployments, the `app-config.js` value can be templated from an env var at container startup via the OHIF Docker entrypoint; pure-static hosts edit the served config or use the Preferences panel.)

## 3.  Register the Viewer as a Client

Open the viewer, register it as a SMART client from the Preferences page if you haven't already, then complete the SMART launch from the RIS reading worklist. With CORS in place, FHIR requests go straight to `:3200` (verify in DevTools → Network: absolute origin, **no `/fhir-proxy`**).

## 4.  Order and Complete an Exam on a Patient