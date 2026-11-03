/**
 * Flag schemas (`node:util.parseArgs` option tables) and the shared flag help
 * text. Split out of `args.ts`, which re-exports `LIST_CATEGORIES` and
 * `ListCategory` so its public surface is unchanged.
 */

import type { ParseArgsConfig } from "node:util";

type Options = NonNullable<ParseArgsConfig["options"]>;

// Everything about reaching and framing the page — no root. Almost every
// command takes exactly this set: they read (or act on) Chromium's native
// accessibility tree, which is whole-document, so a scoping selector has
// nothing to mean. A flag that silently did nothing would be worse than not
// offering it. Leaving `root` out also stops a config `defaults.root` from
// reaching them, since `mergeDefaults` is keyed on each command's declared
// flags.
export const PAGE_FLAGS: Options = {
  device: { type: "string" },
  viewport: { type: "string" },
  "wait-until": { type: "string" },
  settle: { type: "string" },
  timeout: { type: "string" },
  headful: { type: "boolean" },
  cdp: { type: "string" },
  "chrome-path": { type: "string" },
  "allow-file": { type: "boolean" },
  "storage-state": { type: "string" },
  "audit-origin": { type: "string", multiple: true },
  session: { type: "string" },
  "session-idle-timeout": { type: "string" },
  // Strict mode (ADR-0001's `redactInput`): no field value and no rich-text
  // editor content in any output. A page flag because it governs every read
  // of the page, the act commands' diffs included — and per run, not per
  // browser, so a reused `--session` can't carry it from one invocation into
  // the next.
  "redact-input": { type: "boolean" },
};

export const OUTPUT_FLAGS: Options = {
  format: { type: "string", short: "f" },
  output: { type: "string", short: "o" },
  quiet: { type: "boolean", short: "q" },
  verbose: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

// Every command accepts these so an a11y.config.json can seed its flags (the
// `defaults` block). run.ts discovers + merges the config after parsing.
export const CONFIG_FLAGS: Options = {
  config: { type: "string" },
  "no-config": { type: "boolean" },
};

export const AUDIT_FLAGS: Options = {
  ...PAGE_FLAGS,
  ...OUTPUT_FLAGS,
  ...CONFIG_FLAGS,
  rules: { type: "string" },
  "fail-on": { type: "string" },
  "no-annotate": { type: "boolean" },
};

// inspect renders the tree, so it (and only it, among the gate commands)
// takes --include-generic — audit accepting-but-ignoring it would be worse
// than the strict parser rejecting it.
export const INSPECT_FLAGS: Options = {
  ...AUDIT_FLAGS,
  "include-generic": { type: "boolean" },
};

export const VIEW_FLAGS: Options = {
  ...PAGE_FLAGS,
  ...OUTPUT_FLAGS,
  ...CONFIG_FLAGS,
  "include-generic": { type: "boolean" },
};

// `tabs` is the DOM holdout, so it — alone — still takes `--root`. Tab order is
// the one view the native tree cannot produce (it knows per-node `focusable`,
// but not the SEQUENCE — `tabindex` never reaches a native node), so `tabs`
// still runs the in-page walk, and a walk is the only thing a selector scopes.
//
// Otherwise identical to VIEW_FLAGS. `--include-generic` is inert here (a
// generic container is never a tab stop) but `outline`, `list`, and `snapshot`
// accept-and-ignore it too — dropping it from this one command would make the
// surface arbitrary, and is not a change this PR set out to make.
export const TABS_FLAGS: Options = {
  ...VIEW_FLAGS,
  root: { type: "string" },
};

// The act commands. `interact` takes an ordered, repeatable --step; the sugar
// verbs take one target apiece and share the same machinery.
export const INTERACT_FLAGS: Options = {
  ...PAGE_FLAGS,
  ...OUTPUT_FLAGS,
  ...CONFIG_FLAGS,
  step: { type: "string", multiple: true },
  "step-settle": { type: "string" },
};

// All three sugar verbs parse --text, but only `type` accepts it: click/focus
// REJECT it by name ("--text applies to `type`") instead of leaving the strict
// parser to answer a sibling command's flag with a wall of positional-argument
// advice. Rejecting-with-the-remedy beats both ignoring it and a generic parse
// error; the help text advertises it only where it works.
export const ACT_FLAGS: Options = {
  ...PAGE_FLAGS,
  ...OUTPUT_FLAGS,
  ...CONFIG_FLAGS,
  role: { type: "string" },
  name: { type: "string" },
  nth: { type: "string" },
  text: { type: "string" },
  "step-settle": { type: "string" },
};

// install is a setup command: no browser/output/emulation flags — it
// downloads a browser, it doesn't drive one.
export const INSTALL_FLAGS: Options = {
  ...CONFIG_FLAGS,
  channel: { type: "string" },
  version: { type: "string" },
  force: { type: "boolean" },
  quiet: { type: "boolean", short: "q" },
  verbose: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

// login is a narrow, interactive command: no format/output/emulation/auth
// flags — it forces headful and writes a session file.
export const LOGIN_FLAGS: Options = {
  ...CONFIG_FLAGS,
  save: { type: "string" },
  "wait-until": { type: "string" },
  settle: { type: "string" },
  timeout: { type: "string" },
  verbose: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

// session is a lifecycle command: list, stop, stop-all daemon sessions. It has
// no page flags — it never launches a browser itself.
export const SESSION_FLAGS: Options = {
  ...CONFIG_FLAGS,
  ...OUTPUT_FLAGS,
  strict: { type: "boolean" },
};

// snapshot audits a config-/env-supplied page set and writes the JSON artifact.
export const SNAPSHOT_FLAGS: Options = {
  ...PAGE_FLAGS,
  ...CONFIG_FLAGS,
  "include-generic": { type: "boolean" },
  // Field values in the artifact's views. Opt-in: an artifact is committed and
  // posted, so what users typed stays out unless a run asks for it.
  values: { type: "boolean" },
  rules: { type: "string" },
  md: { type: "boolean" },
  format: { type: "string", short: "f" },
  only: { type: "string" },
  baseline: { type: "string" },
  "update-baseline": { type: "boolean" },
  "fail-on": { type: "string" },
  output: { type: "string", short: "o" },
  quiet: { type: "boolean", short: "q" },
  verbose: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

// diff is pure — two JSON files in, no browser, so no browser flags.
export const DIFF_FLAGS: Options = {
  ...CONFIG_FLAGS,
  "fail-on": { type: "string" },
  baseline: { type: "string" },
  "ignore-view-line": { type: "string", multiple: true },
  explain: { type: "boolean" },
  only: { type: "string" },
  "max-lines": { type: "string" },
  "max-pages": { type: "string" },
  format: { type: "string", short: "f" },
  output: { type: "string", short: "o" },
  quiet: { type: "boolean", short: "q" },
  verbose: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

export const LIST_CATEGORIES = [
  "heading",
  "link",
  "button",
  "form",
  "landmark",
  "image",
] as const;
export type ListCategory = (typeof LIST_CATEGORIES)[number];

// Everything except `--root` — which is now every command but `tabs`. They all
// read Chromium's whole-document native tree, so there is nothing for a
// selector to scope, and listing a flag they reject would promise scoping that
// never applies.
export const SHARED_FLAG_HELP_NO_ROOT = `  --device <name>        Emulate a device, e.g. "iPhone 13"
  --viewport <WxH>       e.g. 1280x800
  --wait-until <state>   load|domcontentloaded|networkidle|commit (default: load)
  --settle <ms>          Extra wait after load            (default: 0)
  --timeout <ms>         Navigation timeout               (default: 30000)
  -f, --format <fmt>     pretty | json                    (default: pretty)
  -o, --output <file>    Write the report to a file (progress stays on stderr)
  --headful              Show the browser window
  --storage-state <file> Audit as a logged-in user, using a saved session
                         (create it with: real-a11y login <url> --save <file>)
  --audit-origin <origin>  Extra origin allowed under --storage-state
                         (repeatable; defaults to the target's own origin)
  --cdp <endpoint>       Attach to a running Chrome — the interactive way to
                         audit a login (no emulation flags over CDP)
  --chrome-path <file>   Browser binary to launch (default: the Chrome from
                         'real-a11y install', else Playwright's Chromium)
  --redact-input         Strict mode: withhold EVERY field value and all
                         rich-text editor content, not just sensitive fields
  --config <file>        a11y.config.json (auto-discovered in cwd) — its
                         "defaults" seed any flag you don't pass
  --no-config            Ignore an auto-discovered config
  -q, --quiet            Suppress progress
  --verbose              Extra diagnostics on stderr`;

/** `tabs` only — the one command still running the in-page DOM walk. */
export const SHARED_FLAG_HELP_ROOT = `  --root <selector>      Scope the tab-order walk         (default: body)
${SHARED_FLAG_HELP_NO_ROOT}`;
