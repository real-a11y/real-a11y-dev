---
title: "@real-a11y-dev/cli — a11y.config.json reference"
description: Every a11y.config.json key — urls, defaults (every settable flag), and redact — with types, defaults, and the CLI flag each maps to.
---

# `a11y.config.json`

Your accessibility policy, committed to your repo — the Jest/ESLint model. `a11y.config.json` names the routes you audit and seeds the flags every command runs with, so a configured repo audits itself with no flags: a bare `real-a11y audit` walks the whole list, each view command inherits your emulation and wait settings, and `snapshot` diffs the same routes run to run.

The file is **strict JSON** — no JS config, no `eval` — and **fail-closed**: an unknown or mistyped key (`"failon"` for [`failOn`](#failon), a bad value like `failOn: "sometimes"`) is a hard error, never a silent no-op. A silently-ignored gate key could un-gate CI, so the loader refuses to guess. It's repo-controlled and low-trust, hence the guardrails: a 1 MB file cap, a 100-entry [`urls`](#urls) cap, and a compile-check on every [`redact`](#redact) pattern at load — a bad regex fails on startup, not mid-run.

The config is **optional**. Without one, every command works from flags and positional URLs alone.

**Discovery.** Auto-discovered as `./a11y.config.json` in the directory you run from — no upward walk in v1, so you inherit only a config in the current directory, never a parent's. `--config <file>` points elsewhere; `--no-config` ignores a discovered one. Both flags are accepted on every command.

**Precedence** is `flag > env > config defaults > built-in`. An explicit flag always wins, so a config default is a floor you override per run, never a ceiling you can't escape. (The env layer is `A11Y_PAGES` for the page list and `A11Y_SNAPSHOT_OUT` for `snapshot`'s output — see [`urls`](#urls).)

A minimal, complete config:

```json
{
  "urls": [
    "http://localhost:3000",
    { "name": "Login", "url": "http://localhost:3000/login", "rootSelector": "main" }
  ],
  "defaults": {
    "device": "iPhone 13",
    "waitUntil": "networkidle",
    "rules": ["no-unlabeled-interactive", "image-alt"],
    "failOn": "error"
  },
  "redact": ["token=[^&]+"]
}
```

## Top-level keys

Three keys: [`urls`](#urls) (what to audit), [`defaults`](#defaults) (how to audit it), and [`redact`](#redact) (what to strip from output). Everything else is rejected — except four back-compat aliases (the old `pages`, plus three top-level shorthands); see [Legacy shorthands](#legacy-shorthands).

### `urls`

**`urls: (string | { url, name?, rootSelector?, sourcePath? })[]`** — optional · non-empty · max 100 entries

The project's audit targets. Each entry is a **bare URL string**, or an **object** with a required `url` plus optional fields. A bare string's [`name`](#urls) defaults to the URL itself.

A configured `urls` list drives a bare **`audit`** and **`snapshot`** — run either with no positional and it audits every entry, so you don't re-type routes. Single-view commands (`tree` / `outline` / `tabs` / `list`) still take exactly one URL. `diff` reads two snapshot artifacts, not this list (but it does read [`defaults`](#defaults)).

Entry fields:

- **`url`** — the target. Any URL the browser can reach: a public site, a local dev server, staging, or a built file path.
- **`name`** — the diff join key and display label. This is what pairs a route across two snapshots, so keep it stable when a URL changes. Defaults to `url`.
- **`rootSelector`** — scope extraction to a region for this route (per-page [`root`](#root)); the semantic tree is taken from the matching element down.
- **`sourcePath`** — repo-relative file the route's findings anchor to in [SARIF](/packages/cli#sarif-junit-jsonl). GitHub code scanning only displays results tied to a file path; without it, results anchor to the config file.

```json
{
  "urls": [
    "https://example.com",
    { "name": "Dashboard", "url": "http://localhost:3000/app", "rootSelector": "#root", "sourcePath": "src/pages/App.tsx" }
  ]
}
```

Precedence for the audited list: positional URLs → the `A11Y_PAGES` env var (JSON `[{name,url}]`) → this `urls` list. Positionals are gated as `arg`; env and config go through the stricter `config` URL gate.

### `defaults`

**`defaults: object`** — optional · always materialized (possibly empty)

Seeds a value for any flag you don't pass, on every command that declares it — the Jest/ESLint "virtual flag" model. Each key mirrors a CLI flag; the merge injects the value in the flag's raw shape and hands it to the command's own parser, so a config default is validated exactly like a typed flag would be. See [`defaults` keys](#defaults-keys) for the full table.

Two merge rules keep precedence honest:

- **Explicit flag wins.** A default only fills a flag you left unset — it never overwrites `--device` you typed.
- **Only reaches commands that accept the flag.** An emulation default (e.g. [`device`](#device)) can't seed `login`, which declares no emulation flags — so a default never trips a parser the equivalent flag couldn't.

A `defaults`-only config (no [`urls`](#urls)) is valid — useful when you drive URLs positionally but want shared emulation and gate settings.

### `redact`

**`redact: string[]`** — optional

Extra regex patterns applied to URLs and text before anything is printed or written — for stripping session tokens, signed-URL query params, or PII that would otherwise land in a report or a committed snapshot. Each pattern is `new RegExp`-compiled at load, so an invalid pattern fails on startup rather than mid-audit.

```json
{ "redact": ["token=[^&]+", "\\bsig=[A-Za-z0-9]+"] }
```

## `defaults` keys

Every key below maps to one CLI flag. The meta line gives its JSON type, the flag it seeds, the built-in default it overrides, and the commands it reaches — a default only seeds a command that **declares** that flag. Throughout, **the view commands** means `tree` / `outline` / `tabs` / `list`. Order and types are exactly the loader's allowlist; anything outside it is rejected at load.

Two path-valued keys — [`storageState`](#storagestate) and [`baseline`](#baseline) — resolve **relative to the config file's directory**, so a committed config is portable no matter which directory a command runs from.

### `root`

**`root: string`** — flag `--root` · default `body` · applies to `audit`, `inspect`, the view commands, `snapshot`

Scope extraction to a CSS selector — audit a single region or component instead of the whole page. For per-route scoping, prefer [`urls[].rootSelector`](#urls).

### `device`

**`device: string`** — flag `--device` · default: unset · applies to `audit`, `inspect`, the view commands, `snapshot`

Emulate a Playwright device profile — `"iPhone 13"`, `"Pixel 7"` — to audit what a screen reader hears on the mobile layout. Suppressed when you pass `--cdp` (which reuses a running browser and can't emulate).

```json
{ "defaults": { "device": "iPhone 13" } }
```

### `viewport`

**`viewport: string`** — flag `--viewport` · default: unset · applies to `audit`, `inspect`, the view commands, `snapshot`

Explicit viewport as `WIDTHxHEIGHT`, e.g. `"1280x800"`. Suppressed when you pass `--cdp`.

### `waitUntil`

**`waitUntil: string`** — flag `--wait-until` · default `load` · applies to `audit`, `inspect`, the view commands, `snapshot`, `login`

Navigation settle state before extraction: `load` | `domcontentloaded` | `networkidle` | `commit`. Bump to `networkidle` for JS-heavy SPAs whose accessible content lands after first paint.

### `settleMs`

**`settleMs: number`** — flag `--settle` · default `0` · max `30000` · applies to `audit`, `inspect`, the view commands, `snapshot`, `login`

Extra milliseconds to wait after [`waitUntil`](#waituntil) resolves — for content that animates or hydrates in after the load event.

### `timeoutMs`

**`timeoutMs: number`** — flag `--timeout` · default `30000` · max `120000` · applies to `audit`, `inspect`, the view commands, `snapshot`, `login`

Navigation timeout in milliseconds.

### `headful`

**`headful: boolean`** — flag `--headful` · default `false` · applies to `audit`, `inspect`, the view commands, `snapshot`

Show the browser window instead of running headless. Suppressed when you pass `--cdp`.

### `storageState`

**`storageState: string`** — flag `--storage-state` · default: unset · **path (resolves from the config dir)** · applies to `audit`, `inspect`, the view commands, `snapshot`

Audit as a logged-in user, using a session file saved by `real-a11y login`. The path resolves relative to the config file, so a committed config stays portable. Suppressed when you pass `--cdp` (CDP reuses the running browser's own session). See [Authenticated pages](/guide/authenticated-pages).

```json
{ "defaults": { "storageState": "./.auth/session.json" } }
```

### `auditOrigins`

**`auditOrigins: string[]`** — flag `--audit-origin` (repeatable) · default: the target's own origin · applies to `audit`, `inspect`, the view commands, `snapshot`

Extra origins allowed under [`storageState`](#storagestate) — origin pinning that stops a redirect from routing extraction to an unintended, cookie-matching origin. Each entry must be a full origin like `https://app.example.com`.

### `format`

**`format: string`** — flag `-f, --format` · default `pretty` (`json` on `snapshot`) · applies to `audit`, `inspect`, the view commands, `snapshot`, `diff`

Output format. **Validated per command**, so a global default only has to be valid where it lands: `audit` / `inspect` / view commands take `pretty | json`; `snapshot` takes `json | md | sarif | junit | jsonl`; `diff` takes `pretty | json | md`. A project-wide `format: "sarif"` seeds `snapshot` cleanly but errors on `audit`. Suppressed on `snapshot` when you pass the `--md` shorthand.

### `rules`

**`rules: string[]`** — flag `--rules` · default: all five rules · applies to `audit`, `inspect`, `snapshot`

Restrict the run to a subset of the semantic-tree rules. Valid ids: `no-unlabeled-interactive`, `image-alt`, `heading-order`, `dialog-labeled`, `landmark-structure` — an unknown id is a load error.

```json
{ "defaults": { "rules": ["no-unlabeled-interactive", "image-alt"] } }
```

### `failOn`

**`failOn: "error" | "warning" | "never"`** — flag `--fail-on` · default `error` (`never` on `snapshot`) · applies to `audit`, `inspect`, `snapshot`, `diff`

The gate threshold — the lowest severity that exits `1`. `snapshot` defaults to `never` (it just writes the artifact); set it there to gate the snapshot itself. View commands are never gates and always exit `0`, so this doesn't reach them.

### `annotate`

**`annotate: boolean`** — flag `--no-annotate` (as `annotate: false`) · default `true` · applies to `audit`, `inspect`

GitHub Actions annotations (grouped `::error` lines + a job summary), on by default. Only `annotate: false` is meaningful — it seeds `--no-annotate`; `annotate: true` is the built-in and seeds nothing.

### `includeGeneric`

**`includeGeneric: boolean`** — flag `--include-generic` · default `false` · applies to `inspect`, the view commands, `snapshot`

Keep generic container nodes (no role, no name) in the serialized tree. Off by default so output shows only what a screen reader announces. Declared on every view command; only tree-rendering output (`tree`, `inspect`, `snapshot`) actually consumes it.

### `baseline`

**`baseline: string`** — flag `--baseline` · default: unset · **path (resolves from the config dir)** · applies to `snapshot`, `diff`

Suppress findings a baseline file has accepted — adopt the gate on a codebase with existing debt without silencing new regressions. Suppressed findings stay in the report (marked `"suppressed": true`), just out of the `--fail-on` count. Path resolves relative to the config file. See [Adopt the gate on existing debt](/packages/cli#adopt-the-gate-on-existing-debt).

### `ignoreViewLine`

**`ignoreViewLine: string[]`** — flag `--ignore-view-line` (repeatable) · default: none · applies to `diff`

Drop view lines matching these regexes before diffing — for generated content that changes every build (a "last updated" timestamp, a build hash) and would otherwise read as drift on every page.

```json
{ "defaults": { "ignoreViewLine": ["^time \""] } }
```

### `maxLines`

**`maxLines: number`** — flag `--max-lines` · default: full · applies to `diff`

Cap each page's structural diff to _n_ lines, then `… N more`. For CI comments — run once uncapped to a log, once capped to the comment. See [the CI diff bot guide](/guide/ci-diff-bot).

### `maxPages`

**`maxPages: number`** — flag `--max-pages` · default: all · applies to `diff`

Detail at most _n_ changed routes, then list the rest by name. For CI comments.

### `explain`

**`explain: boolean`** — flag `--explain` · default `false` · applies to `diff`

Add the plain-language structural summary to a diff ("Heading level changed: h2 → h3", "Keyboard tab stop removed …"). Opt-in because it's an interpretive layer; the neutral default makes no claim the raw diff can't back up.

## Not settable

Five declared flags are deliberately **excluded** from `defaults` — no config key can populate them:

- **`--output` / `--quiet` / `--verbose`** — per-run I/O and log-verbosity concerns, not project policy. Where output goes and how loud a run is belong to the invocation, not the committed file.
- **`--allow-file` / `--cdp`** — security-sensitive. `--allow-file` unlocks the `file:` gate and `--cdp` attaches to a running Chrome; a committed config must not be able to silently widen the trust boundary of every run. They stay explicit, per invocation. (They're also the *triggers* that suppress conflicting defaults — passing `--cdp` drops the seeded [`device`](#device) / [`viewport`](#viewport) / [`headful`](#headful) / [`storageState`](#storagestate), and `--md` drops [`format`](#format) — so a config default never trips a guard against a flag you actually typed.)

## Legacy shorthands

Four top-level keys are accepted for back-compat — each folds into its canonical home:

- **`pages`** — the former name for [`urls`](#urls). Still parsed; `urls` wins if both are present.
- **`rules`** / **`failOn`** / **`device`** at the top level — shorthand for the same keys under `defaults`.

Prefer the current forms; the shorthands may be removed before 1.0.

## See also

- [`@real-a11y-dev/cli`](/packages/cli) — commands, flags, and exit codes.
- [Adopt the gate on existing debt](/packages/cli#adopt-the-gate-on-existing-debt) — baselines.
- [The CI diff bot](/guide/ci-diff-bot) — `snapshot` + `diff` in a PR.
- [Authenticated pages](/guide/authenticated-pages) — `storageState` and `--cdp`.
