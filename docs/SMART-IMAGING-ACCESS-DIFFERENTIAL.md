# SMART Imaging Access — differential against our stack

What the [Argonaut SMART Imaging Access IG](https://build.fhir.org/ig/argonautproject/smart-imaging/)
requires, versus what the OHIF FHIR Viewer, Medplum, node-on-fhir, and
dcmjs-commands do today, and the delta to conform.

## The spec in one paragraph

A client discovers imaging support **in band** from
`<fhir-base>/.well-known/smart-configuration`: either the top-level
`capabilities[]` contains `smart-imaging-access` (clinical and imaging FHIR are
the same server), or an entry in `associated_endpoints[]` carries that
capability (imaging FHIR is a separate base). The client runs a normal SMART App
Launch (authorization_code + PKCE) or Backend Services (client_credentials,
asymmetric), then searches
`GET <imaging-base>/ImagingStudy?patient=<id>&_include=ImagingStudy:endpoint`,
resolves each study's `ImagingStudy.endpoint` (an `Endpoint` with
`connectionType = dicom-wado-rs`) to a WADO-RS base, and retrieves pixels there.
**One** access token is honored across the FHIR search and the WADO-RS
retrieval; the WADO-RS server validates it (typically by introspection), it is
not re-exchanged. The "networks" page is non-normative context (TEFCA / IHE) —
it defines no separate discovery protocol.

The four moving parts: **(D)** discovery, **(A)** auth, **(S)** ImagingStudy +
Endpoint search, **(W)** token-bearing WADO-RS retrieval.

## Where each component stands

### OHIF FHIR Viewer extension (the client)

| Part | Today | Delta to conform |
|---|---|---|
| D | Imaging endpoint is **static config** (`dicomWebRoot` / `qidoRoot` / `wadoRoot`, set in `window.config`). No reading of `associated_endpoints`. | Read `smart-configuration`; if `smart-imaging-access` is present top-level or in `associated_endpoints[]`, derive the imaging base from there instead of requiring `dicomWebRoot`. |
| A | Full SMART App Launch with PKCE already implemented (`smartAuth.js`), token kept in `_config`. | Request scope `patient/ImagingStudy.rs` (SMART v2) — the PR already moved toward `user/*.rs`; align with the spec's study scope. Backend Services mode absent (out of scope for a browser SPA). |
| S | The PR added `registerImagingStudyContext` / `metadata()` paths that fetch ImagingStudy and, when it has no instances, delegate to DICOMweb. It does **not** resolve `ImagingStudy.endpoint` per study — it uses the one configured root for all. | Resolve `ImagingStudy.endpoint` (`dicom-wado-rs`) **per study** and point the DICOMweb delegate at that study's WADO base, instead of a single global `wadoRoot`. Request `_include=ImagingStudy:endpoint`. |
| W | The PR bridges the SMART bearer token into every DICOMweb request (`_bridgeAuthToken`). | This is exactly what the spec wants — **one token to WADO-RS** — but it is currently **ungated by origin** (see PR1-MERGE-VERDICT.md, finding 1). For the spec's "the imaging server trusts the same token" model, gate it to the resolved Endpoint origin(s). |

**Net for the extension:** it already has the hard parts (SMART launch, token
pass-through to WADO). The conformance delta is **discovery from
`associated_endpoints`** and **per-study `ImagingStudy.endpoint` resolution**,
replacing the static `dicomWebRoot`. `dcmjs-commands/src/smart/*` is a working
reference for both (see below) and can be ported almost directly.

### Medplum (observed, 5.1.18)

| Part | Today | Delta |
|---|---|---|
| D | `smart-configuration` is served, but **does not** advertise `smart-imaging-access` and has **no** `associated_endpoints` (verified). | Add `smart-imaging-access` to `capabilities[]` (clinical == imaging base) to be discoverable. |
| A | SMART v2 scopes, PKCE, introspection endpoint all present. | None for App Launch; already supports `client-confidential-asymmetric` for Backend Services. |
| S | `ImagingStudy?_include=ImagingStudy:endpoint` **works** (verified: returns the ImagingStudy + its Endpoint). | None — the FHIR search layer conforms. |
| W | Medplum does **not serve pixels**: its only DICOM routes are empty stubs at `/dicom/PS3/*` (bare 200s). Pixels come from whatever `Endpoint.address` points at. | For an end-to-end Medplum deployment, `Endpoint.address` must point at a real WADO-RS server that introspects Medplum tokens. Medplum is the clinical+imaging FHIR layer, not the pixel source. |

### node-on-fhir / Lattice

| Part | Today | Delta |
|---|---|---|
| D | No `smart-configuration` advertising imaging; `settings.fhir.smart.json` covers SMART but not the imaging capability. | Advertise `smart-imaging-access`. |
| S | `radiology-workflow` creates `ImagingStudy` resources **without** instance data and **without** `Endpoint` references; no `_include=ImagingStudy:endpoint`. | Populate `ImagingStudy.endpoint` → an `Endpoint` (`dicom-wado-rs`) and support the `_include`. |
| W | No QIDO/WADO routes at all (see Phase 9 / NoF DicomWeb work). | Implement WADO-RS that accepts the bearer token — this is the Phase 9 task. |

So node-on-fhir needs the most: it is missing both the Endpoint layer (S) and
the pixel server (W). Phase 9's DicomWeb package covers W; the Endpoint wiring is
a small addition to `radiology-workflow`.

### dcmjs-commands (reference client — already conformant)

`src/commands/patientAccess.js` + `src/smart/{discovery,appLaunch,imagingStudy}.js`
implement the **client** side of the IG end to end:

- **D** — `fetchSmartConfiguration` + `findImagingEndpoint` parse
  `associated_endpoints[].capabilities` for `smart-imaging-access`.
- **A** — PKCE App Launch with a loopback redirect listener.
- **S** — `ImagingStudy?patient=…&_include=ImagingStudy:endpoint`, then
  `resolveEndpoint` follows `ImagingStudy.endpoint` preferring
  `connectionType.code = dicom-wado-rs` (handles contained/relative/absolute
  references).
- **W** — per-study WADO base, bearer token on each request.

**Gap:** Backend Services mode (`system/ImagingStudy.rs`, client_credentials) is
**not** implemented — only App Launch. That is the one piece missing for full IG
coverage, and it is the natural next addition to `dcmjs-commands`.

## Summary of the differential

1. **Extension:** swap static `dicomWebRoot` for discovery via
   `associated_endpoints` + per-study `ImagingStudy.endpoint` resolution; keep
   the (origin-gated) token bridge. Port `dcmjs-commands/src/smart/*`.
2. **Medplum:** advertise `smart-imaging-access`; point `Endpoint.address` at a
   real WADO-RS server (Medplum itself serves no pixels).
3. **node-on-fhir:** advertise the capability, populate `ImagingStudy.endpoint`,
   and serve token-bearing WADO-RS (Phase 9).
4. **dcmjs-commands:** add Backend Services mode to reach full IG coverage.

The common thread: everyone can already do the FHIR search and the SMART launch;
the consistent gap is **endpoint discovery/resolution** (so the client learns the
WADO base from FHIR rather than config) and, for node-on-fhir, **a WADO-RS
server that honors the token**.
