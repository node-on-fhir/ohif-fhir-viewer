# Installing @ohif/fhir-viewer: Env-Var vs CLI vs Setup Script

An experiment report comparing the three ways this extension (and its bundled
`fhir-viewer` mode) can be installed into the OHIF Viewers monorepo. Run on
2026-07-14 against the `cli-tool` branch (pnpm 11.5.2 workspace, yarn 1.22.4
available on PATH).

## TL;DR

All three patterns now converge on the same build-time mechanism
(`platform/app/.webpack/writePluginImportsFile.js`). After a ~10-line change to
that file, `pnpm run cli link-extension extensions/ohif-fhir-viewer` works
end-to-end — the CLI writes the `pluginConfig.json` registration and the build
auto-detects the bundled mode. The env-var approach continues to work
unchanged, and both can coexist (declarations are de-duplicated by package
name, with the env entry winning). The team does not have to pick a single
winner: the CLI decides *what gets committed*, the env var decides *what a
given deployment loads* — they layer.

## The three patterns

| | Env var | OHIF CLI | scripts/setup.js |
|---|---|---|---|
| Invocation | `EXTRA_EXTENSIONS=@ohif/fhir-viewer pnpm dev` | `pnpm run cli link-extension extensions/ohif-fhir-viewer` | `node extensions/ohif-fhir-viewer/scripts/setup.js` |
| Registration lives in | Process environment (12-factor config) | `platform/app/pluginConfig.json` (tracked file) | `platform/app/pluginConfig.json` + copies `mode/` → `modes/fhir-viewer/` + patches `webpack.pwa.js` proxy |
| Mode handling | Auto-detected from the extension's `mode/` subdir | Auto-detected (after the fix below); previously not handled at all | Copied into `modes/` and registered explicitly |
| Tracked-file mutation | None | `pluginConfig.json` (intended); `webpack.pwa.js` (unintended, see below) | `pluginConfig.json`, `webpack.pwa.js`, new `modes/fhir-viewer/` tree |
| Rebuild required | Yes | Yes | Yes |
| Removal | Unset the variable | `pnpm run cli unlink-extension @ohif/fhir-viewer` | Manual |

Note the "rebuild" row: **neither approach avoids recompilation.** Every
pattern feeds the same `writePluginImportsFile.js` step that regenerates
`src/pluginImports.js` at webpack-config load. The difference is purely whether
the registration is committed to the repo or carried in the environment.

## What the experiment showed

### `add-extension` — does not work for this extension (by design)

```
$ pnpm run cli add-extension @ohif/fhir-viewer
Adding ohif-extension @ohif/fhir-viewer...
[15:58:14] Searching for extension: @ohif/fhir-viewer [failed]
[15:58:14] → Error package @ohif/fhir-viewer not found
```

`add-extension` validates against the NPM registry
(`platform/cli/src/commands/utils/validate.js`) and installs via `npm info` +
package install. `@ohif/fhir-viewer` is not published, so this path is only
viable if we publish the package to NPM with the `ohif-extension` keyword
(which it already has in `package.json`). A future option, not a today option.

### `link-extension` — works, with friction

`pnpm run cli link-extension extensions/ohif-fhir-viewer` performed:

1. Keyword validation against the local `package.json` (`ohif-extension` — already present, no change needed). ✅
2. `yarn link` in the extension dir + `yarn link @ohif/fhir-viewer` at the repo
   root. **Redundant**: the extension is already a pnpm workspace member via
   the `extensions/*` glob, so module resolution never uses these symlinks.
   They also mix yarn-v1 state into a pnpm-managed `node_modules`.
3. Appended a `node_modules` path to the `modules:` array of
   `platform/app/.webpack/webpack.pwa.js`. The path it wrote was **wrong** —
   `path.resolve(__dirname, 'extensions/ohif-fhir-viewer/node_modules')`
   resolves relative to `platform/app/.webpack/`, a directory that does not
   exist. Harmless (webpack skips missing resolve dirs) but it dirties a
   tracked upstream file with a broken entry. We reverted this hunk.
4. Appended `{ "packageName": "@ohif/fhir-viewer", "version": "0.0.1" }` to
   `platform/app/pluginConfig.json`. ✅ **This is the one durable, useful
   effect.**
5. Crashed at the final step (`yarn prettier --write` — prettier is not
   resolvable via `yarn run` in this pnpm tree). The crash happens *after*
   steps 1–4, so the registration survives.

Two environment gotchas worth recording:

- The CLI is yarn-hardcoded (`validateYarn`, `execa('yarn', ...)`), inside a
  monorepo whose `packageManager` is pnpm. It even mixes managers internally
  (`uninstallNPMPackage.js` uses pnpm).
- `validateYarn` spawns `yarn` without a shell, so a `PATH` entry like
  `~/.yarn/bin` (unexpanded tilde, fine for bash) makes the CLI report "Yarn is
  not installed". Workaround: `PATH="$HOME/.yarn/bin:$PATH" pnpm run cli ...`.

### The mode gap, and the fix

The CLI registers only the extension. Nothing in `link-extension` knows about
the bundled `mode/` package, and before this experiment the companion-mode
auto-detection in `writePluginImportsFile.js` only scanned `EXTRA_EXTENSIONS` —
so a CLI-registered extension would load without its mode.

The fix (in `platform/app/.webpack/writePluginImportsFile.js`):

1. The companion-mode auto-detect loop now iterates the fully-merged
   `pluginConfig.extensions` list (which already includes the env-injected
   entries) instead of re-parsing `EXTRA_EXTENSIONS`. Any declared extension —
   from `pluginConfig.json`, `APP_PLUGIN_CONFIG`, or `EXTRA_EXTENSIONS` — with
   a `mode/package.json` gets its mode registered automatically.
2. The `EXTRA_EXTENSIONS` / `EXTRA_MODES` append now goes through the existing
   `mergePluginList()` helper, so declaring the same extension in both
   `pluginConfig.json` and the env var no longer produces a duplicate
   registration (the env entry replaces the file entry, preserving env-var
   precedence).

### Verified end state

With **no** environment variables set and only the CLI's `pluginConfig.json`
entry present, the generated `src/pluginImports.js` contains both plugins and
webpack resolves them from the right places:

```
extensions.push("@ohif/fhir-viewer");
modes.push("fhir-viewer");

@ohif/fhir-viewer$ -> <repo>/extensions/ohif-fhir-viewer
fhir-viewer$       -> <repo>/extensions/ohif-fhir-viewer/mode
```

The same holds with `EXTRA_EXTENSIONS=@ohif/fhir-viewer` set (no duplicates),
and with the stock config (fhir entries removed, no env vars) the standard
build is byte-identical to before — no first-party extension has a `mode/`
subdirectory, so the widened auto-detect is a no-op for upstream.

## Trade-offs, stated neutrally

**For the CLI / pluginConfig pattern:** the registration is visible in the
repo, reviewable in a PR, and versioned — "what does this deployment include?"
is answered by `git show`. It is the documented upstream OHIF pattern, so it
matches contributor expectations.

**Against it:** `pluginConfig.json` is a tracked upstream file, and this repo's
own conventions (CLAUDE.md: "Append to pluginConfig.json — don't reorder",
"Never modify upstream files") exist precisely because it is a merge-conflict
hotspot. Every fork that registers plugins there diverges from upstream at the
same lines. The CLI's implementation also shows its age (yarn-v1 assumptions,
broken webpack edit, prettier crash) — it needs maintenance investment if it
is to be the blessed path.

**For the env-var pattern:** zero tracked-file mutation, so `git pull` from
upstream OHIF stays clean; per-environment composition (dev vs demo vs prod can
load different plugin sets from the same commit); consistent with 12-factor
config for hosted deployments.

**Against it:** the loaded plugin set is invisible in the repo — it lives in
`.env` files, CI variables, or shell history, which makes "what is actually
deployed?" an ops question rather than a `git` question. It is also
non-standard relative to upstream OHIF documentation.

**Reconciliation:** these are layers, not rivals. `pluginConfig.json` (written
by hand, by the CLI, or by `setup.js`) is the committed baseline;
`APP_PLUGIN_CONFIG` selects a tracked per-deployment override; `EXTRA_*` env
vars get the last word at build time. After this experiment's fix, the bundled
mode follows the extension through every one of those doors.
