# Node on FHIR — RIS Integration

Step-by-step guide for setting up a Node on FHIR instance as the backend RIS for the  OHIF FHIR Viewer.


## 1. Install and Run the OHIF Viewer
Begin by installing the OHIF Viewer

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

# new terminal
open http://localhost:3000/fhir-viewer
```

> **Mode auto-detection:** when an `EXTRA_EXTENSIONS` package contains a `mode/`
> subdirectory with a `package.json`, that mode is registered automatically. To
> override or add other modes explicitly, use `EXTRA_MODES` (a comma-separated list
> of `<name>` or `<name>=<directory>` entries).

OHIF starts on `http://localhost:3000/fhir-viewer` by default (override with `OHIF_PORT`), which should appear with an empty viewport.  

<img width="2560" height="1440" alt="Screenshot 2026-07-19 at 1 29 00 PM" src="https://github.com/user-attachments/assets/6991dfab-74d3-418e-8644-44eab98b4e60" />


## 2. Install and Run the Node on FHIR Radiology System (RIS)

### 2A. Run Node on FHIR (on Port 3100)

Install Meteor 3.4, clone the Honeycomb starter, and run it:

```bash
cd ..
curl https://install.meteor.com?release=3.4 | sh

git clone https://github.com/node-on-fhir/core
git submodule update --init libraries/dcmjs

cd core

meteor npm install
meteor run --port 3100

open http://localhost:3100
Ctrl+C
```

When you first run Node on FHIR without a settings file, you'll get the project banner and then the Getting Started screen, which provides a configuration utility for generating custom settings files.  We will be skipping this step with a settings file that ships with the main app, but it is available for those who wish to dig deeper.  Just know if this screen appears, the dependencies have been installed, the server has compiled, and everything is running correctly.  

<img width="2560" height="1440" alt="Screenshot 2026-07-20 at 8 23 17 AM" src="https://github.com/user-attachments/assets/05a8f48b-6745-458a-9a01-4f0576ffadc8" />

<img width="2560" height="1440" alt="Screenshot 2026-07-20 at 8 23 20 AM" src="https://github.com/user-attachments/assets/1f6ea52d-275c-44cc-b51d-6abf0f9819c1" />


### 2B. Add the Radiology Workflow Packages and a Settings file

NodeOnFHIR ships with a `radiology-workflow` package in the `npmPackages/` directory, which we will use via the `EXTRA_WORKFLOWS` environment variable:

```bash
INITIALIZE_CONSENT_ENGINE=true CORS=localhost EXTRA_WORKFLOWS=@node-on-fhir/radiology-workflow,@node-on-fhir/fhircast-module,@node-on-fhir/record-lifecycle,@node-on-fhir/clinical:us-core,@node-on-fhir/admin-tools,@node-on-fhir/data-importer,@node-on-fhir/international-patient-summary meteor run --settings npmPackages/fhircast/settings/settings.fhircast.json --port 3100

open http://localhost:3100
Ctrl+C
```

You should see the authentication guard, the sign-up page, and then the main workflow page.  

<img width="2560" height="1440" alt="Screenshot 2026-07-20 at 8 31 34 AM" src="https://github.com/user-attachments/assets/671a1f00-0c9d-46a7-9466-61ba099f0205" />

<img width="2560" height="1440" alt="Screenshot 2026-07-19 at 8 23 03 PM" src="https://github.com/user-attachments/assets/323ecc2c-ea8e-43cd-8396-7b5aabe23546" />

<img width="2560" height="1440" alt="Screenshot 2026-07-19 at 8 23 30 PM" src="https://github.com/user-attachments/assets/6a2aba63-4620-435a-bbae-19dbc4c8ead8" />



### 3. Register an OAuth Client

The OHIF viewer authenticates against Node on FHIR using SMART on FHIR (OAuth 2.0). You need to register a client so the RIS knows which app is requesting access.  


#### 3A.  OHIF FHIR Viewer registration via User Preferences

The OHIF FHIR Viewer has configuration controls in the Settings > User Preferences panel, which can be used to register OHIF with the FHIR Server.  Just click the (autogenerate) buttons, or fill out the fields with your preferred values.

```
open http://localhost:3000/fhir-viewer
```

<img width="2560" height="1440" alt="Screenshot 2026-07-19 at 11 07 17 PM" src="https://github.com/user-attachments/assets/04afb0b2-e508-458d-8cf4-6f581b89147b" />

#### 3B.  POST to the /oauth/register endpoint
A second approach to registering the oauth client is to POST a JSON object with the following shape to the `http://localhost:3100/oauth/register` endpoint:

```json
{
  "client_name": "OHIF FHIR Viewer",
  "redirect_uris": ["http://localhost:3000/fhir-viewer"],
  "scope": "launch openid fhirUser patient/*.read",
  "grant_types": ["authorization_code"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "client_secret_basic"
}
```

#### 3C.  Register a New Client in the RIS User Interface
A third approach, is you may also navigate to `http://localhost:3100/oauth-clients` and click **"+ New Client"**. Fill in the following fields:

| Field | Value |
|---|---|
| **Client Name** | `OHIF FHIR Viewer` |
| **Redirect URIs** | `http://localhost:3200/fhir-viewer` |
| **Scopes** | `launch openid fhirUser patient/*.read` |
| **Grant Types** | `authorization_code` |
| **Response Types** | `code` |
| **Token Endpoint Auth Method** | `client_secret_basic` |

You may also wish to press the SHIFT+CTRL+I button to enable the Index in the Sidebar, and navigate to the OAuth Clients table via the user interface.  

<img width="2560" height="1440" alt="Screenshot 2026-07-19 at 10 15 56 PM" src="https://github.com/user-attachments/assets/ff273733-c2b7-4d83-897f-997ddddf3dd8" />

<img width="2560" height="1440" alt="Screenshot 2026-07-19 at 11 07 39 PM" src="https://github.com/user-attachments/assets/48b0d7a0-8317-436d-94ef-112417ce84fb" />


#### Additional Notes on Registering the OAuth Client

OHIF FHIR Viewer extensions read the client_id at **runtime** from one of the following three browser-native surfaces, in most-specific-wins order.  For SMART Launch contexts, the RIS will provide the client_id when it opens OHIF.  For stand-alone launch workflows, you will want to add the FHIR Server URL and client ID to the User Preferences and store locally.  

1. **URL** — `?client_id=…` on the SMART launch (per-launch; lets one deployment face multiple registrations).
2. **SMART Preferences panel** — entered/registered in OHIF, saved to `localStorage` (per-user).
3. **`window.config`** — the `smartClientId` field in the data source `configuration` of the served `app-config.js` (per-deployment).


## 4.  Load a sample Patient into the the RIS

Once registered, you may wish to load a sample patient into the RIS.  Sample patients have been included in the NodeOnFHIR core project in the `npmPackages/synthea/data/patients` directory.  These records are in `.phr` file format, which is simply a flavor of NDJSON.  For more information on the `.phr` file format, see the [HL7 Personal Health Records Implementation Guide](https://build.fhir.org/ig/HL7/personal-health-record-format-ig/en/). 


<img width="2560" height="1440" alt="Screenshot 2026-07-19 at 11 07 54 PM" src="https://github.com/user-attachments/assets/14070ab3-31f1-4bc6-bbdc-da56da841268" />

<img width="2560" height="1440" alt="Screenshot 2026-07-19 at 11 27 28 PM" src="https://github.com/user-attachments/assets/9187a84a-e769-4372-b924-35b61c058f44" />

<img width="2560" height="1440" alt="Screenshot 2026-07-19 at 11 27 47 PM" src="https://github.com/user-attachments/assets/c749846c-58be-45eb-943c-d27d89804590" />

<img width="2560" height="1440" alt="Screenshot 2026-07-19 at 11 27 55 PM" src="https://github.com/user-attachments/assets/9d6f2d13-0c24-4aa7-949d-f40c44aa4109" />

<img width="2560" height="1440" alt="Screenshot 2026-07-19 at 11 28 01 PM" src="https://github.com/user-attachments/assets/2273b31e-29e9-4f5c-ad26-e77c83680773" />

<img width="2560" height="1440" alt="Screenshot 2026-07-19 at 11 28 33 PM" src="https://github.com/user-attachments/assets/06606822-4383-4024-bd85-93d97c535c3a" />


## 5.  Order and Complete an Exam on a Patient


### 5A.  Order the Exam

<img width="2560" height="1440" alt="Screenshot 2026-07-20 at 8 59 04 AM" src="https://github.com/user-attachments/assets/26b19470-08ee-4102-ad36-b09e86917ad8" />


<img width="2560" height="1440" alt="Screenshot 2026-07-20 at 8 59 22 AM" src="https://github.com/user-attachments/assets/cbc1f111-599e-4bb1-b3ff-929ab997242b" />

<img width="2560" height="1440" alt="Screenshot 2026-07-19 at 11 29 30 PM" src="https://github.com/user-attachments/assets/f03aa554-f157-4260-80de-ea50613ad46b" />

### 5B.  Start the Exam

<img width="2560" height="1440" alt="Screenshot 2026-07-19 at 11 29 41 PM" src="https://github.com/user-attachments/assets/069de216-1f23-49fe-86e3-1091a3ed7600" />

<img width="2560" height="1440" alt="Screenshot 2026-07-19 at 11 29 45 PM" src="https://github.com/user-attachments/assets/7c6adc22-c665-45cd-a9aa-5d7c09b502c6" />

<img width="2560" height="1440" alt="Screenshot 2026-07-19 at 11 29 49 PM" src="https://github.com/user-attachments/assets/298a8b5e-a14b-45c7-81b5-aad020cc0d01" />


### 5C.  Attach a .DCM File







## 6.  Launch the Imaging Study in OHIF FHIR Viewer




## 7.  Subscribe to Updates Via FHIRCast


### 7A.  Subscribe to Events



### 7B.  Finalize the Radiology Report



### 7C.  Observe event updates in the OHIF FHIR Viewer

























