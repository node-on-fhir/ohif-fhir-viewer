# Autogenerate Chips for SMART Preferences Inputs — Design

**Date:** 2026-07-19
**Status:** Approved

## Goal

Add "Autogenerate" button chips as end adornments (right-aligned, inside the input) to two fields in the SMART on FHIR section of `SmartPreferencesModal` (`src/customizations/SmartPreferencesModal.tsx`):

1. **Client ID** — clicking the chip sets the field to a freshly generated UUID via `crypto.randomUUID()`.
2. **FHIR Server URL** — clicking the chip sets the field to the default value `http://localhost:3100/baseR4` (same as the existing placeholder).

Both chips overwrite any existing value in their field.

## Approach

The `@ohif/ui-next` `Input` is a shadcn-style bare `<input>` with no adornment support. Patching upstream `ui-next` is forbidden by workspace conventions (never modify upstream files), so the chip is implemented entirely inside this extension:

- Wrap each target input in a `relative` div.
- Render the chip as a `<button type="button">` positioned `absolute right-1.5 top-1/2 -translate-y-1/2`.
- Give the input right padding (`pr-28`) so typed text never runs under the chip.
- Chip styling (Tailwind only, per OHIF conventions): `rounded-full px-2 py-0.5 text-xs bg-primary/20 text-primary hover:bg-primary/30`, label text "Autogenerate".
- A small `AutogenChip` helper component defined inside `SmartPreferencesModal.tsx` keeps the two usages consistent.

## Behavior details

- **Client ID chip:** `setState(s => ({ ...s, smartClientId: crypto.randomUUID() }))`. A locally minted UUID is only meaningful against dev FHIR servers that accept arbitrary client IDs; the existing Register (dynamic client registration) flow remains the canonical path and is unchanged. The two coexist.
- **FHIR Server URL chip:** `setState(s => ({ ...s, fhirBaseUrl: 'http://localhost:3100/baseR4' }))`. The default is extracted to a named constant shared with the input's `placeholder` so the two cannot drift.
- No new state, no persistence changes — chips call the existing `setState`; Save/localStorage (`fhir_smart_config`) behavior is untouched.
- The empty-state hint under Client ID ("No client ID configured. Use Register to obtain one.") remains as-is.

## Error handling

`crypto.randomUUID()` is available in all modern secure contexts (and localhost). No fallback is needed for this dev-oriented feature.

## Testing

Manual verification in the running viewer: open Settings → Preferences, confirm both chips render right-aligned inside their inputs, clicking fills the expected values (fresh UUID each click; exact default URL), typed text does not underlap the chips, and Save persists the values as before.
