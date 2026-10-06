# PR #1 merge verdict — `fhircast-dicomweb-and-persistent-session`

ThatOneBro → node-on-fhir/ohif-fhir-viewer, 3 commits on top of `main`
(`b046bc5` DICOMweb image source + ImagingStudy-open handling, `339a204`
persistent module-scoped FHIRcast session, `4a03aa4` docs).

## Verdict: **merge with follow-ups — not as-is**

The branch is functionally correct and was verified end-to-end against a live
Medplum (see "Runtime verification"). It is a clean fast-forward on `main` and
GitHub reports it mergeable. But it ships **two issues that should be fixed
before or immediately after merge**, **zero tests** for ~900 new lines, and
some noise. None of the issues block the happy path; all are real.

The opt-in contract holds: with no DICOMweb root configured, the new image-source
path never builds a delegate and behavior is unchanged. That is now pinned by
tests (see Phase 3b — `dicomWebDelegation.test.js`).

## Runtime verification (what actually works)

Against Medplum 5.1.18 (FHIRcast R4 hub) + a Static-DICOMweb tree of the MEYER
MRI study, via the OHIF dev server:

- SMART token injected → FHIR reads authorized.
- FHIRcast subscribe to `pr1-test-topic` → WebSocket **Open**.
- Publish `ImagingStudy-open` (stub with only an `id`) → viewer fetched the full
  ImagingStudy, navigated to it (`?StudyInstanceUIDs=…&patient=…`), and
  **rendered pixels** from the DICOMweb delegate (12 series / 480 instances).
- Switched the right side-panel tabs → the WebSocket stayed **Open**, the
  subscription and received-events list survived (the persistent-session fix
  works as designed).
- Left the study and reopened it in-app → **rendered** (no black viewport — the
  `displaySetService.init()` cache-skip fix works).

## Findings

### Blocker-ish (fix before relying on this in a split FHIR/PACS deployment)

1. **SMART/OHIF bearer token is bridged to DICOMweb with no origin gating.**
   `src/FhirDataSource/index.js` `_bridgeAuthToken()` replaces OHIF's *global*
   `userAuthenticationService.getAuthorizationHeader` so every DICOMweb request
   carries `Bearer <token>`, regardless of whether `dicomWebRoot`/`wadoRoot`
   share an origin with the FHIR/SMART issuer. A deployment that points
   `dicomWebRoot` at a different host than the auth server (a normal PACS split)
   leaks the token to that third-party origin on every QIDO/WADO request.
   *Fix:* attach the bridged token only when the request origin matches the FHIR
   issuer origin or an explicitly allow-listed DICOMweb origin.
   *Note:* in our Medplum test everything is same-origin-ish (all localhost), so
   this did not surface at runtime — it is a latent exposure, not a visible bug.

2. **`stopFhircastContextListener` is exported but never called → socket +
   context listener leak on mode exit.** `src/index.tsx` `onModeExit()` calls
   only `suspendFhircastContextListener()` (confirmed: no caller of
   `stopFhircastContextListener` anywhere). Leaving the viewer keeps the hub
   subscription, the WebSocket, and the context listener alive for the page
   lifetime. This may be the intended "connection outlives the view" design — if
   so, delete the dead export; if not, wire it into `onModeExit`. Either way the
   current exported-but-unused cleanup is a latent bug.

### Should-fix

3. **Single-topic unsubscribe tears down the whole connection.**
   `fhircastSession.ts` `stopSubscription(topic?)` always closes the socket and
   nulls `activeParams`/`endpointId` regardless of the `topic` passed, while the
   UI exposes per-subscription unsubscribe. The store models `subscriptions` as
   a `Record` (plural), but the session only ever tracks one connection —
   unsubscribing a non-active topic still kills the live socket. Decide
   single- vs multi-subscription and make the teardown match.

4. **Indefinite resubscribe-POST loop against a hard-failing hub.** Reconnect
   retries forever with a 30s ceiling (deliberate, for backgrounded tabs), but
   once past `REOPEN_ATTEMPTS_BEFORE_RESUBSCRIBE` every attempt re-POSTs
   `hub.mode=subscribe`. A hub that is up but rejects the subscription (e.g. 401
   after token expiry) produces an endless 30s-interval POST with no terminal
   state surfaced to the user. Consider a ceiling on the *resubscribe POST*
   specifically, or a surfaced "subscription failed" state.

5. **`getStudyInstanceUIDs` behavior change runs outside the opt-in boundary.**
   It now parses a `StudyInstanceUIDs` query/route param, reorders and dedupes —
   unconditionally, not gated behind DICOMweb config. Equivalent for the common
   no-param case, but a deployment that relied on the old "ignore the URL, return
   the store list" behavior would see a change. Low risk; call it out. (Now
   covered by tests.)

### Nits

- Heavy unconditional `console.log` on hot paths (metadata, every reconnect at
  30s, every context event). Consider a debug flag. Consistent with the existing
  `[FHIR]` logging style, so not blocking.
- **Doc inaccuracy (confirmed):** `MEDPLUM-INTEGRATION.md` §6 says "Medplum
  serves the pixels over DICOMweb at `<server>/dicomweb`" and configures
  `dicomWebRoot: 'http://localhost:8103/dicomweb'`. **Medplum has no such
  route** — its only DICOM routes are the empty stubs at `/dicom/PS3/*` (bare
  200s, no payload). To test, pixels must come from a separate DICOMweb server
  (we used a Static-DICOMweb tree on :5100). §6's config block and the
  "Medplum only implements WADO-RS frames" claim need correcting.
- No new inline-style / Tailwind violations introduced by this diff.

## Tests added (Phase 3b)

The PR shipped no tests. Added 37 (Jest): `fhircastSession`, `fhircastContextListener`,
`FhirDataSource` DICOMweb delegation, and `activatePanelFromUrl` — all green
(87 total). A tooling fix was needed first (`fix(test): make the jest suite
runnable again`); the committed lockfile and babel test env could not run Jest
at all.

## Note on process

No PR comments have been posted. If you want these findings relayed onto the
GitHub PR, say so and I'll post them.
