# dcmjs in the OHIF FHIR Viewer — dependency analysis

## TL;DR

The extension imports `dcmjs` in three places but does not declare it. It only
works today because the OHIF monorepo hoists `dcmjs@0.52.0` to the root
`node_modules`, where the extension's bare `import dcmjs from 'dcmjs'` finds it
at bundle time. That is fragile: the version the extension resolves depends on
where it is built, and in a standalone/test context it silently falls back to a
*different* dcmjs (0.38.3, bundled by `dcmjs-ecg`). Declare dcmjs as a
`peerDependency` pinned to the version OHIF ships (`0.52.0`), matching how the
extension already declares `@ohif/core`.

## Where dcmjs is used

| File | API | Purpose |
|---|---|---|
| `src/FhirDataSource/dicomLoader.js` | `DicomMessage.readFile`, `DicomMetaDictionary.naturalizeDataset` | Parse DICOM Part 10 from a FHIR attachment and naturalize the dataset |
| `src/FhirDataSource/index.js` | `dcmjs.data` (DicomDict / DicomMetaDictionary) | Build the SR Part 10 for the `Save to FHIR` DocumentReference export |
| `src/FhirDataSource/__tests__/dicomLoader.test.js` | fixtures | Round-trip test data |

All three use the **0.52 surface** (`data.DicomMessage`, `data.DicomMetaDictionary`)
— the stable, long-standing API, nothing exotic.

## The resolution problem

- The extension's `package.json` lists `dcmjs-ecg@^0.0.14` but **not** `dcmjs`.
- `dcmjs-ecg` depends on `dcmjs@0.38.3`, so there is always a copy of 0.38.3
  reachable from the extension's own `node_modules`.
- The OHIF app pins `dcmjs@0.52.0` (catalog in `pnpm-workspace.yaml`, plus
  `platform/core` and `platform/app`), hoisted to the monorepo root.
- At **bundle time** inside the monorepo, the extension's `import dcmjs from
  'dcmjs'` resolves to the hoisted **0.52.0** — correct, but only by accident of
  hoisting order.
- In a **standalone** build (the side-by-side layout the README documents) or in
  **Jest**, the nearest `dcmjs` is `dcmjs-ecg`'s **0.38.3**. `jest.config.js`
  already works around this by mapping `^dcmjs$` to the Viewers copy with a
  fallback — a tell that the implicit resolution is a known hazard.

Net: the extension depends on dcmjs but lets the environment decide which one,
and the two candidates are 14 minor versions apart.

## Recommendation: declare it as a peerDependency `0.52.0`

Add to `peerDependencies` (not `dependencies`):

```json
"dcmjs": "0.52.0"
```

Rationale:

- **peer, not dep** — mirrors `@ohif/core` and the other OHIF packages. A direct
  `dependency` would install a *second* dcmjs into the extension's own
  `node_modules`, defeating the hoisting the bundle relies on and risking two
  copies in the output. The README's `--config.auto-install-peers=false` install
  step exists precisely so peers resolve from the host OHIF build.
- **0.52.0, exact** — matches the app's catalog pin, so the declared contract
  equals what actually ships.
- Pairs with an `exact` entry so a standalone consumer knows what to provide.

This changes nothing about the current working monorepo build; it makes the
real requirement explicit and gives a standalone build a declaration to satisfy.

## Relationship to dcmjs 1.0-beta (`@dcmjs-org/dcmjs`)

The 1.0-beta wrapper (PR dcmjs-org/dcmjs#595) reproduces the full 0.52 surface
(`data`, `adapters`, `sr`, `normalizers`, `utilities`, `anonymizer`, `DICOMWEB`,
…) and adds `fhir` (`toFhir`/`toBundle`/`fromPart10`), `eventStream`, `media`,
`encapsulated`, and `image`. Because the 0.52 surface is preserved, this
extension would keep working against `@dcmjs-org/dcmjs` unchanged — and two of
the new namespaces are directly relevant here:

- **`fhir`** — the extension currently maps DICOM⇄FHIR by hand
  (`fhirToOhif.js`, the SR DocumentReference builder). `dcmjs.fhir.toFhir` /
  `toBundle` / `fromPart10` could replace parts of that, and is the natural
  building block for the SMART Imaging Access differential.
- **`eventStream`** — streaming Part 10 reads, useful if the DICOMweb delegate
  ever needs to parse instances client-side.

Adopting 1.0-beta is a later step; it would be an alias
(`"dcmjs": "npm:@dcmjs-org/dcmjs@1.0.0-beta"`) or a `file:` reference, and the
peerDependency declaration recommended above is the clean starting point either
way.
