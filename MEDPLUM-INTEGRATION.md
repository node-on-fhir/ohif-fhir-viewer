# Medplum Integration

Step-by-step guide for setting up [Medplum](https://www.medplum.com/) as the FHIR R4
backend (and FHIRcast hub) for the OHIF FHIR Viewer.

Medplum is a good fit for this viewer's **CORS-direct** model: it ships with
`allowedOrigins: "*"` in development, so the browser calls the FHIR and FHIRcast
endpoints directly — no dev proxy required.

## 6. Install and Run the OHIF Viewer

Begin by installing the OHIF Viewer.

```bash
# create a working directory
mkdir demo && cd demo

# install OHIF and the FHIR extension
git clone https://github.com/OHIF/Viewers
cd Viewers/extensions
git clone https://github.com/node-on-fhir/ohif-fhir-viewer
cd ..

# link the workspace packages
yarn install
```

The extension and its bundled `fhir-viewer` mode are injected at startup through
the `EXTRA_EXTENSIONS` / `EXTRA_MODES` environment variables — no edits to
`pluginConfig.json` are required. The Medplum admin app runs on `:3000` (OHIF's
default), so start OHIF on **`:3200`** with `OHIF_PORT`:

```bash
OHIF_PORT=3200 EXTRA_EXTENSIONS=@ohif/extension-nof-ohif-viewer EXTRA_MODES=fhir-viewer=extensions/ohif-fhir-viewer/mode yarn dev
```

> **Note on the mode path:** the `fhir-viewer` mode ships nested inside the
> extension at `extensions/ohif-fhir-viewer/mode`, so it isn't a top-level
> workspace package. The `=<directory>` suffix points `EXTRA_MODES` straight at
> it. (Alternatively, copy that folder to `modes/fhir-viewer` and use the bare
> `EXTRA_MODES=fhir-viewer`.)

The viewer is now available at `http://localhost:3200/fhir-viewer`.

## 2. Install and Run Medplum

Medplum needs Redis and PostgreSQL (provided via Docker), the API server, and the
admin app. See the [Medplum local dev docs](https://www.medplum.com/docs/contributing/run-the-stack)
for first-time clone/build steps.

| Service | URL | Notes |
|---|---|---|
| Medplum server | `http://localhost:8103` | FHIR R4 API + FHIRcast hub |
| Medplum app | `http://localhost:3000` | Admin UI for resource management |
| Redis | `localhost:6379` | Docker container `redis-1` |
| PostgreSQL | `localhost:5432` | Docker container `postgres-1` |

```bash
# Redis and Postgres
cd medplum
docker compose up -d

# Medplum API server (FHIR R4 + FHIRcast hub) on :8103
cd packages/server
npm run dev
```

The Medplum admin app runs on `http://localhost:3000` (start it per the Medplum
docs if it isn't already running).

> **CORS:** Medplum's dev config sets `allowedOrigins: "*"`, so OHIF (on `:3200`)
> can call the FHIR, OAuth, and FHIRcast endpoints on `:8103` directly. No
> `/fhir-proxy` and no `FHIR_SERVER` setting are involved — the browser talks to
> Medplum at its absolute origin.

## 3. Register the Viewer as a Client

OHIF authenticates against Medplum using SMART on FHIR (OAuth 2.0). Register a
`ClientApplication` so Medplum knows which app is requesting access.

1. In the Medplum app, navigate to `http://localhost:3000/ClientApplication/new`.
2. Set:
   - **Name**: `OHIF Viewer`
   - **Redirect URI**: `http://localhost:3200/fhir-viewer`
   - **Launch URI**: `http://localhost:3200/fhir-viewer`
3. Save.
4. **Copy the ClientApplication UUID** from the URL bar
   (`http://localhost:3000/ClientApplication/<uuid>`) — this is your SMART client ID.

Supply that UUID to OHIF at **runtime** — there is no `SMART_CLIENT_ID` build var
(OHIF is a static SPA). Use any of, most-specific wins:

1. **URL** — `?client_id=<uuid>` appended to the launch (per-launch).
2. **SMART Preferences panel** in OHIF — paste/register the client ID (per-user, saved to localStorage).
3. **`window.config`** — the `smartClientId` field in the data source `configuration` of the served `app-config.js` (per-deployment).

## 4. Order and Complete an Exam on a Patient

### A. Create test data in the Medplum app (`http://localhost:3000`)

1. **Patient** — sidebar → **Patient** → **New…**, fill name fields, save. Note the Patient ID.
2. **ServiceRequest** (the order) — **New…**, set `status: active`, `intent: order`,
   `subject: Patient/<id>`, a `code` (e.g. "CT Chest"), save.
3. **DiagnosticReport** (optional) — **New…**, set `status: preliminary`, `subject`,
   `basedOn: ServiceRequest/<id>`, a `code`, save.
4. **ImagingStudy** (optional) — **New…**, `status: available`, link to the Patient via `subject`.

### B. Trigger the SMART launch

1. Navigate to the Patient: `http://localhost:3000/Patient/<patient-id>`.
2. Click the **Apps** tab → click **OHIF Viewer**.
3. Medplum redirects the browser to
   `http://localhost:3200/fhir-viewer?iss=http://localhost:8103/fhir/R4&launch=<launch-id>`.
4. OHIF detects both `iss` and `launch` (Case B), discovers SMART config at
   `http://localhost:8103/fhir/R4/.well-known/smart-configuration`, and redirects to
   Medplum's authorize endpoint.
5. Authenticate at Medplum (or use the existing session) and grant consent. Medplum
   redirects back with `?code=…&state=…`; OHIF exchanges the code for a token at
   `/oauth2/token` and loads the patient's studies.

## 5. Verify FHIRcast

The fastest interop check skips the OAuth dance by injecting a token manually.

### A. Quick test with a manual token

1. **Get a token** — in the Medplum app console (`http://localhost:3000`):
   ```js
   JSON.parse(localStorage.getItem('@medplum:activeLogin')).accessToken
   ```
2. **Open OHIF with the ISS** (Case C — sets the FHIR server without an OAuth redirect):
   ```
   http://localhost:3200/fhir-viewer?iss=http://localhost:8103/fhir/R4
   ```
3. **Inject the token** in the OHIF tab's console, then **reload the same tab**
   (`sessionStorage` is per-tab):
   ```js
   sessionStorage.setItem('fhir_smart_token', JSON.stringify({
     access_token: '<PASTE-TOKEN>',
     expires_in: 3600,
     _savedAt: Date.now(),
   }));
   ```

### B. Subscribe and publish

1. Open the **FhirCast** panel. The hub URL auto-populates from the ISS origin as
   `http://localhost:8103/api/hub` (called directly — no proxy).
2. Enter a topic (any string), select `patient-open` / `imagingstudy-open`, click **Subscribe**.
   Expect HTTP 202 and the WebSocket status to go **Open** (Medplum returns
   `ws://localhost:8103/ws/fhircast-r4/<uuid>`, used directly).
3. Publish a `Patient-open` event from a terminal:
   ```bash
   TOKEN="<access-token>"
   TOPIC="<topic-from-panel>"
   curl -s -X POST "http://localhost:8103/fhircast/hub/$TOPIC" \
     -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{
       "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
       "id": "'$(uuidgen)'",
       "event": {
         "hub.topic": "'$TOPIC'",
         "hub.event": "Patient-open",
         "context": [{"key": "patient", "resource": {"resourceType": "Patient", "id": "test-patient-123"}}]
       }
     }'
   ```
4. The event should appear in the panel's **Received Events**. Wait 10+ seconds —
   **no `syncerror`** should appear (confirms OHIF's ACK reached Medplum). Click
   **Unsubscribe** for a clean disconnect.

### Success criteria

| Check | Expected |
|---|---|
| `.well-known/fhircast-configuration` | JSON with `eventsSupported` |
| Token injection | Persists after reload (same tab) |
| Hub URL auto-populated | `http://localhost:8103/api/hub` |
| Subscription POST | HTTP 202 Accepted |
| WebSocket | Opens successfully |
| Event delivery | Appears in OHIF panel |
| Event ACK | No SyncError after 10s |
| Unsubscribe | Clean disconnect |

---

For the full SMART EHR launch walkthrough, isolated curl hub tests, the Medplum
demo app, comparison testing, and troubleshooting, see `CLAUDE-MEDPLUM-TESTING.md`
in the workspace root.
