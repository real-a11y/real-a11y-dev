/**
 * Command table, flag schemas, and help text. Flags are parsed by
 * `node:util.parseArgs` (strict); this module owns everything the parser
 * needs plus the validated typed views over its output.
 *
 * Help text is hand-written and lists only *shipped* commands/formats — a
 * flag the help advertises must never be an unimplemented error.
 */

import type { ParseArgsConfig } from "node:util";

import { ALL_RULES, type A11yRule } from "@real-a11y-dev/audit";
import type { ChromeChannel, OpenOptions } from "@real-a11y-dev/browser";

import { CliError, type FailOn } from "./exit.js";

export type FlagValues = Record<string, string | boolean | undefined>;
export type CommandFn = (
  positionals: string[],
  flags: FlagValues,
  /**
   * Flags whose value was seeded from `a11y.config.json`'s `defaults` rather
   * than typed on the command line. Once merged the two are indistinguishable
   * in `flags`, so a command that treats a flag as "the user deliberately
   * overrode this for one run" must consult this to tell them apart.
   */
  seededFromConfig?: ReadonlySet<string>,
) => Promise<number>;

type Options = NonNullable<ParseArgsConfig["options"]>;

// Everything about reaching and framing the page — no root. Almost every
// command takes exactly this set: they read (or act on) Chromium's native
// accessibility tree, which is whole-document, so a scoping selector has
// nothing to mean. A flag that silently did nothing would be worse than not
// offering it. Leaving `root` out also stops a config `defaults.root` from
// reaching them, since `mergeDefaults` is keyed on each command's declared
// flags.
const PAGE_FLAGS: Options = {
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
};

const OUTPUT_FLAGS: Options = {
  format: { type: "string", short: "f" },
  output: { type: "string", short: "o" },
  quiet: { type: "boolean", short: "q" },
  verbose: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

// Every command accepts these so an a11y.config.json can seed its flags (the
// `defaults` block). run.ts discovers + merges the config after parsing.
const CONFIG_FLAGS: Options = {
  config: { type: "string" },
  "no-config": { type: "boolean" },
};

const AUDIT_FLAGS: Options = {
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
const INSPECT_FLAGS: Options = {
  ...AUDIT_FLAGS,
  "include-generic": { type: "boolean" },
};

const VIEW_FLAGS: Options = {
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
const TABS_FLAGS: Options = {
  ...VIEW_FLAGS,
  root: { type: "string" },
};

// The act commands. `interact` takes an ordered, repeatable --step; the sugar
// verbs take one target apiece and share the same machinery.
const INTERACT_FLAGS: Options = {
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
const ACT_FLAGS: Options = {
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
const INSTALL_FLAGS: Options = {
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
const LOGIN_FLAGS: Options = {
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
const SESSION_FLAGS: Options = {
  ...CONFIG_FLAGS,
  ...OUTPUT_FLAGS,
  strict: { type: "boolean" },
};

// snapshot audits a config-/env-supplied page set and writes the JSON artifact.
const SNAPSHOT_FLAGS: Options = {
  ...PAGE_FLAGS,
  ...CONFIG_FLAGS,
  "include-generic": { type: "boolean" },
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
const DIFF_FLAGS: Options = {
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
const SHARED_FLAG_HELP_NO_ROOT = `  --device <name>        Emulate a device, e.g. "iPhone 13"
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
  --config <file>        a11y.config.json (auto-discovered in cwd) — its
                         "defaults" seed any flag you don't pass
  --no-config            Ignore an auto-discovered config
  -q, --quiet            Suppress progress
  --verbose              Extra diagnostics on stderr`;

/** `tabs` only — the one command still running the in-page DOM walk. */
const SHARED_FLAG_HELP_ROOT = `  --root <selector>      Scope the tab-order walk         (default: body)
${SHARED_FLAG_HELP_NO_ROOT}`;

/**
 * Which section of the command reference a command belongs to. Declared here
 * rather than in the markdown so the grouping has one source of truth: the
 * docs' "All commands at a glance" tables are six headed groups, and a new
 * command that lands in none of them is a table row nobody wrote.
 */
export type CommandGroup =
  "setup" | "audit" | "view" | "act" | "artifact" | "session";

export interface CommandSpec {
  summary: string;
  group: CommandGroup;
  /**
   * Which producer builds this command's tree — exactly one, or none.
   *
   * `[]` for the commands that build no tree at all (`install`, `login`,
   * `diff`). Everything else is `["native"]` except `tabs`, which is `["dom"]`
   * because a native tree carries no tab SEQUENCE and an in-page walk is the
   * only source of one.
   *
   * It was a set because `--producer` let a user pick; now each surface has
   * exactly one correct producer and the flag is gone. The field stays — and
   * stays an array — because it is still the fact that explains each command's
   * shape (whole-document reach and no `--root`, versus a scopable in-page
   * walk), it is what `isNativeCommand` derives the `--root` refusal from, and
   * `docs/surface.json` publishes it. A hand-written second copy of that list
   * is the drift this file exists to prevent.
   */
  producers: readonly Producer[];
  options: Options;
  /** Config `defaults` keys that should never seed this command's flags. */
  excludeDefaults?: readonly string[];
  help: string;
  load: () => Promise<CommandFn>;
}

export const COMMANDS: Record<string, CommandSpec> = {
  install: {
    summary: "Download Chrome from Chrome for Testing (first time only)",
    group: "setup",
    producers: [],
    options: INSTALL_FLAGS,
    help: `Usage: real-a11y install [flags]

Download the Chrome for Testing browser into Real A11y's own cache
(~/.cache/real-a11y, or REAL_A11Y_BROWSERS_DIR) and use it for every launched
session from then on. Run it once — re-runs are instant no-ops. Prints the
resolved executable path on stdout.

Playwright (the npm package) is still the driver — this only replaces the
'npx playwright install chromium' browser download. Sessions launched with
--cdp attach to your own Chrome and never use this binary.

Examples:
  real-a11y install                           # latest Stable, first time only
  real-a11y install --channel beta            # track a channel
  real-a11y install --version 131.0.6778.87   # exact build (works even when
                                               # the Chrome for Testing version
                                               # endpoint is unreachable)
  CHROME=$(real-a11y install -q)              # CI: idempotent, path on stdout

Flags:
  --channel <name>       stable | beta | dev | canary     (default: stable)
  --version <buildId>    Exact Chrome build, e.g. 131.0.6778.87
                         (mutually exclusive with --channel)
  --force                Reinstall even if already downloaded
  --config <file>        a11y.config.json whose "defaults" seed unset flags
  --no-config            Ignore an auto-discovered config
  -q, --quiet            Suppress progress (stdout still prints the path)
  --verbose              Extra diagnostics on stderr

Linux CI note: the download installs no system libraries — if launch fails
with a shared-library error, run: npx playwright install-deps chromium
`,
    load: async () => (await import("./commands/install.js")).installCommand,
  },
  audit: {
    summary: "Violations (rule · severity · locator); exits 1 on errors",
    group: "audit",
    producers: ["native"],
    options: AUDIT_FLAGS,
    help: `Usage: real-a11y audit <url...> [flags]

Audit pages against the semantic-tree rules; print violations grouped by
rule. Exits 1 on errors by default — a CI gate with no extra flags.

Audits Chromium's own accessibility tree, which reaches structure no in-page
walk can (a <video controls>'s user-agent-shadow media controls). That tree is
whole-document, so this command takes no --root.

Examples:
  real-a11y audit http://localhost:3000
  real-a11y audit https://stage.example.com --device "iPhone 13" --fail-on warning
  real-a11y audit ./dist/index.html --format json -o report.json

Flags:
  --rules <ids>          Comma-separated subset of: ${ALL_RULES.join(", ")}
  --fail-on <level>      error | warning | never          (default: error)
  --no-annotate          Skip GitHub Actions annotations
${SHARED_FLAG_HELP_NO_ROOT}

Findings go to stdout; progress and errors go to stderr.
`,
    load: async () => (await import("./commands/audit.js")).auditCommand,
  },
  inspect: {
    summary: "Findings + tree + outline in one pass",
    group: "audit",
    // Was dom-only because the snapshot carried a tab order. It no longer
    // does — that is the accepted loss — so it reads the same tree `audit`
    // does, and the two finally agree on findings.
    producers: ["native"],
    options: INSPECT_FLAGS,
    help: `Usage: real-a11y inspect <url> [flags]

Findings plus semantic tree and heading outline — all derived from one read of
Chromium's own accessibility tree, so the views can never disagree, and the
findings always agree with 'real-a11y audit'.

That tree carries no tab order, so this command no longer prints one and takes
no --root. For the tab sequence run 'real-a11y tabs <url>'.

Flags:
  --rules <ids>          Comma-separated subset of: ${ALL_RULES.join(", ")}
  --fail-on <level>      error | warning | never          (default: error)
  --include-generic      Include generic container nodes in the tree
${SHARED_FLAG_HELP_NO_ROOT}
`,
    load: async () => (await import("./commands/inspect.js")).inspectCommand,
  },
  tree: {
    summary: "Semantic tree (role + accessible name)",
    group: "view",
    producers: ["native"],
    options: VIEW_FLAGS,
    help: `Usage: real-a11y tree <url> [flags]

Print the semantic tree — what a screen reader perceives, role by role. Read
from Chromium's own accessibility tree (whole document, so no --root; reaches
user-agent-shadow media controls an in-page walk never sees).

Flags:
  --include-generic      Include generic container nodes
${SHARED_FLAG_HELP_NO_ROOT}
`,
    load: async () => (await import("./commands/views.js")).treeCommand,
  },
  outline: {
    summary: "Heading outline (h1–h6)",
    group: "view",
    producers: ["native"],
    options: VIEW_FLAGS,
    help: `Usage: real-a11y outline <url> [flags]

Print the heading outline, derived from Chromium's own accessibility tree
(whole document, so no --root).

Flags:
${SHARED_FLAG_HELP_NO_ROOT}
`,
    load: async () => (await import("./commands/views.js")).outlineCommand,
  },
  tabs: {
    summary: "Focusable elements in Tab order",
    group: "view",
    // The one DOM holdout, and not a fallback: a native tree knows per-node
    // focusability but not the SEQUENCE, so this is the only source there is.
    // Being an in-page walk is also why it alone still takes `--root`.
    producers: ["dom"],
    options: TABS_FLAGS,
    help: `Usage: real-a11y tabs <url> [flags]

Print every focusable element in Tab order.

The only command still built from the in-page DOM walk, and the only one that
takes --root. Chromium's accessibility tree knows whether a node is focusable,
but not the SEQUENCE — tabindex never reaches it — so tab order is DOM work by
nature, not a fallback.

Flags:
${SHARED_FLAG_HELP_ROOT}
`,
    load: async () => (await import("./commands/views.js")).tabsCommand,
  },
  list: {
    summary: "One category: heading|link|button|form|landmark|image",
    group: "view",
    // `listByRole` runs over a native ExtractionResult just as well as over an
    // Element, so this lists from the same tree `tree` and `audit` read.
    producers: ["native"],
    options: VIEW_FLAGS,
    help: `Usage: real-a11y list <category> <url> [flags]

List every element in one category with role, accessible name, and locator,
from Chromium's own accessibility tree (whole document, so no --root).
Categories: ${LIST_CATEGORIES.join(", ")}

Flags:
${SHARED_FLAG_HELP_NO_ROOT}
`,
    load: async () => (await import("./commands/views.js")).listCommand,
  },
  interact: {
    summary: "Run steps on a page, then show what they changed",
    group: "act",
    producers: ["native"],
    options: INTERACT_FLAGS,
    help: `Usage: real-a11y interact <url> --step '<step>' [--step '<step>' …]

Drive a page through one or more steps, then print the accessibility-tree
diff those steps produced — the answer to "what did that actually change for
a screen reader?". Steps run in order and stop at the first failure.

A step is written the way the tree prints a node:

  <verb> <role> ["<name>"] [nth=<n>] [= <text>]

  verbs                click | type | focus
  "<name>"             the accessible name; omit to match any name,
                       "" to target an UNLABELED control
  nth=<n>              1-based, document order — the spelling the
                       ambiguity error prints, so the fix is copy-paste
  = <text>             type only; everything after the first = is the value

Examples:
  real-a11y interact http://localhost:3000 --step 'click button "Open menu"'
  real-a11y interact http://localhost:3000 \\
    --step 'type textbox "Email" = someone@example.com' \\
    --step 'click button "Sign in"'
  real-a11y interact https://example.com --step 'click button "Save" nth=2'

Targets resolve against CHROMIUM'S OWN accessibility tree by role + accessible
name — never a CSS selector. If a control can't be reached that way, assistive
technology can't reach it either, and that is an accessibility finding rather
than a targeting inconvenience. Ambiguous matches list their nth= candidates;
a disabled target is refused (the page would ignore the action, leaving a
misleading empty diff).

THE ACTIONS ARE REAL: they submit forms, toggle state, and can NAVIGATE. A step
that loads a new document leaves the tree captured before it describing a page
that no longer exists, so no diff is possible — the run still succeeds and says
where it landed.

Targeting, acting, and the diff all read the same native tree, so a node you
aim at by one name can't come back in the report under another. That tree is
whole-document, which is why these commands take no --root.

A typed value is never echoed — not in progress output, not in --format json.
Don't use this to log in: a password on the command line is visible to other
processes and lands in your shell history. Use 'real-a11y login' instead.

Chromium only.

Flags:
  --step '<step>'        A step to run (repeatable, ordered)   (required)
  --step-settle <ms>     Wait after each step before looking     (default: 200)
${SHARED_FLAG_HELP_NO_ROOT}
`,
    load: async () => (await import("./commands/interact.js")).interactCommand,
  },
  click: {
    summary: "Click one element by role + accessible name",
    group: "act",
    producers: ["native"],
    options: ACT_FLAGS,
    help: `Usage: real-a11y click <url> --role <role> [--name "<name>"] [flags]

Dispatch a real click at the element matched by role + accessible name, then
print the accessibility-tree diff it produced. Shorthand for a one-step
'real-a11y interact' — see 'real-a11y interact --help' for the full contract.

Examples:
  real-a11y click http://localhost:3000 --role button --name "Open menu"
  real-a11y click http://localhost:3000 --role button --name "Save" --nth 2
  real-a11y click http://localhost:3000 --role button --name ""   # unlabeled

Flags:
  --role <role>          ARIA role as the tree prints it       (required)
  --name <name>          Accessible name; omit to match any, "" for unlabeled
  --nth <n>              1-based pick among matches, document order
  --step-settle <ms>     Wait after the action before looking    (default: 200)
${SHARED_FLAG_HELP_NO_ROOT}
`,
    load: async () => (await import("./commands/interact.js")).clickCommand,
  },
  type: {
    summary: "Set a text field's value by role + accessible name",
    group: "act",
    producers: ["native"],
    options: ACT_FLAGS,
    help: `Usage: real-a11y type <url> --role <role> --name "<name>" --text <value>

Replace a text field's value (role is usually textbox, searchbox, or
combobox), then print the accessibility-tree diff — a combobox popping its
options, an inline validation error appearing. Shorthand for a one-step
'real-a11y interact'.

The value is written through the element's own prototype setter plus
input/change events, so framework-controlled inputs (React et al.) register
it. It REPLACES the current value.

Examples:
  real-a11y type http://localhost:3000 --role textbox --name "Email" --text you@example.com
  real-a11y type http://localhost:3000 --role searchbox --name "Search" --text shoes

The value is never echoed back — not in progress output, not in --format json.
Don't use this to log in: a password on the command line is visible to other
processes and lands in your shell history. Use 'real-a11y login' instead.

Flags:
  --role <role>          ARIA role as the tree prints it       (required)
  --name <name>          Accessible name; omit to match any, "" for unlabeled
  --text <value>         The text to enter                     (required)
  --nth <n>              1-based pick among matches, document order
  --step-settle <ms>     Wait after the action before looking    (default: 200)
${SHARED_FLAG_HELP_NO_ROOT}
`,
    load: async () => (await import("./commands/interact.js")).typeCommand,
  },
  focus: {
    summary: "Move real keyboard focus by role + accessible name",
    group: "act",
    producers: ["native"],
    options: ACT_FLAGS,
    help: `Usage: real-a11y focus <url> --role <role> [--name "<name>"] [flags]

Move real keyboard focus to the matched element, then print the
accessibility-tree diff — the focus move shows as a [focused] marker moving.
Useful for checking what a keyboard user lands on, alongside 'real-a11y tabs'.

Examples:
  real-a11y focus http://localhost:3000 --role textbox --name "Email"
  real-a11y focus http://localhost:3000 --role link --name "Skip to content"

Flags:
  --role <role>          ARIA role as the tree prints it       (required)
  --name <name>          Accessible name; omit to match any, "" for unlabeled
  --nth <n>              1-based pick among matches, document order
  --step-settle <ms>     Wait after the action before looking    (default: 200)
${SHARED_FLAG_HELP_NO_ROOT}
`,
    load: async () => (await import("./commands/interact.js")).focusCommand,
  },
  login: {
    summary: "Save a login session for --storage-state audits",
    group: "setup",
    producers: [],
    options: LOGIN_FLAGS,
    help: `Usage: real-a11y login <url> --save <file>

Opens a visible browser. Log in by hand — MFA, SSO, and passkeys all work,
because a human is driving. Then press Enter HERE to save the session to a
file you can later pass to --storage-state.

The saved file holds live session tokens: keep it out of version control
(the command warns if it isn't) and prefer a dedicated low-privilege test
account. Session storage isn't captured — apps that keep auth there need --cdp.

Examples:
  real-a11y login https://app.example.com --save auth.json
  real-a11y audit https://app.example.com/dashboard --storage-state auth.json

Flags:
  --save <file>          Where to write the session          (required)
  --wait-until <state>   load|domcontentloaded|networkidle|commit (default: load)
  --settle <ms>          Extra wait after load               (default: 0)
  --timeout <ms>         Navigation timeout                  (default: 30000)
  --verbose              Extra diagnostics on stderr
`,
    load: async () => (await import("./commands/login.js")).loginCommand,
  },
  session: {
    summary: "List, stop, or stop-all daemon sessions",
    group: "session",
    producers: [],
    options: SESSION_FLAGS,
    // `session list` accepts `--format`, but a project `defaults.format` (e.g.
    // "md") makes no sense for a lifecycle table, so don't seed it from config.
    excludeDefaults: ["format"],
    help: `Usage: real-a11y session <list|stop|stop-all> [flags]

Manage the long-lived browser daemons that invocations with --session reuse.

  list      Print every session, its pid, status, and current URL
  stop      Stop one session by name
  stop-all  Stop every session

Session names are sanitized for filesystem use: non-alphanumeric characters
become underscores and the name is truncated to 64 characters. On Windows,
sessions use named pipes; everywhere else they use Unix domain sockets under
~/.real-a11y/sessions/<name>/.

Examples:
  real-a11y session list
  real-a11y session stop checkout
  real-a11y session stop-all

Flags:
  -f, --format <fmt>     pretty | json, list only         (default: pretty)
  -o, --output <file>    Write the list report to a file, list only
  --strict               With stop-all, exit non-zero if any session is locked
  --config <file>        a11y.config.json whose "defaults" seed unset flags
  --no-config            Ignore an auto-discovered config
  -q, --quiet            Suppress progress
  --verbose              Extra diagnostics on stderr
`,
    load: async () => (await import("./commands/session.js")).sessionCommand,
  },
  snapshot: {
    summary: "Audit a page set → a diffable JSON artifact",
    group: "artifact",
    // Whole-document now: a route's urls[].rootSelector no longer scopes it
    // (snapshot warns, it doesn't fail), and the artifact records the views it
    // measured so the absent tabs view reads as unmeasured, not emptied.
    producers: ["native"],
    options: SNAPSHOT_FLAGS,
    help: `Usage: real-a11y snapshot [url...] [flags]

Audit one or more pages and write ONE JSON artifact — findings (with stable
fingerprints) plus the tree and outline views per page. That artifact is the
input to 'real-a11y diff'.

Built from Chromium's own accessibility tree, which carries no tab order: the
artifact records which views it measured (meta.views) and omits the tabs view
rather than storing an empty one, so a diff reads it as "not measured" instead
of "every tab stop was removed".

Pages, in precedence order: positional URLs, else A11Y_PAGES (JSON
[{name,url}]), else a11y.config.json (--config <file>, or auto-discovered).
Output goes to --output, else A11Y_SNAPSHOT_OUT, else stdout.

Adopt the gate on an existing codebase: --update-baseline records today's
findings, then --baseline suppresses them so only NEW findings fail --fail-on.

Examples:
  real-a11y snapshot https://example.com -o base.json
  real-a11y snapshot --output base.json                 # pages from a11y.config.json
  real-a11y snapshot --config a11y.config.json --md -o report.md
  real-a11y snapshot --config a11y.config.json --update-baseline
  real-a11y snapshot --config a11y.config.json --baseline .a11y-baseline.json --fail-on error

Flags:
  -f, --format <fmt>     json | md | sarif | junit | jsonl   (default: json)
                         sarif needs --config (results anchor to file paths;
                         GitHub: upload with codeql-action/upload-sarif@v4)
  --md                   Shorthand for --format md
  --only <axis>          findings | views — one-axis md report, or a PARTIAL
                         json artifact (marked meta.only; diff refuses it).
                         --fail-on still gates on the full findings; a gating
                         views-only run explains itself on stderr
  --rules <ids>          Comma-separated subset (overrides config)
  --baseline <file>      Suppress findings this baseline accepts (kept in the
                         report, out of the --fail-on count and sarif)
  --update-baseline      Rewrite the baseline from the current findings, then
                         stop (writes .a11y-baseline.json, or --baseline's path)
  --fail-on <level>      Gate on unsuppressed findings: error | warning | never
                         (default: never — snapshot just writes the artifact)
  -o, --output <file>    Where to write (default: A11Y_SNAPSHOT_OUT or stdout)
${SHARED_FLAG_HELP_NO_ROOT}
`,
    load: async () => (await import("./commands/snapshot.js")).snapshotCommand,
  },
  diff: {
    summary: "Findings-aware diff of two snapshot artifacts",
    group: "artifact",
    // Pure: two artifacts in, no page, no tree to produce.
    producers: [],
    options: DIFF_FLAGS,
    help: `Usage: real-a11y diff <base.json> <pr.json> [flags]

Classify the findings in two snapshot artifacts as new / changed / fixed —
robust to DOM churn (re-indentation, renumbered locators) that defeats a line
diff. Pure: no browser. Exits 1 only on NEW findings at/above --fail-on;
fixes and drift never fail the build.

Output is neutral by default — findings plus a real unified diff of the
structure (context + order + indentation, like a PR file diff), shown in full.
Add --explain for a plain-language summary of the changes ("Heading level
changed: h2 → h3", "tab stop removed …").

Examples:
  real-a11y diff base.json pr.json
  real-a11y diff base.json pr.json --explain
  real-a11y diff base.json pr.json --format md --explain --max-pages 5 --max-lines 20 -o comment.md

Flags:
  --fail-on <level>      error | warning | never          (default: error)
  --explain              Add a plain-language summary of structural changes
                         (off by default — the neutral diff makes no inferences)
  --only <axis>          findings | views — report just one axis (output
                         filter; the exit gate still runs on NEW findings)
  --max-lines <n>        Cap the structural diff to n lines per page, then
                         "… N more" (default: full — for CI comments)
  --max-pages <n>        Detail at most n changed pages, then list the rest
                         (default: all — for CI comments)
  --baseline <file>      NEW findings this baseline accepts don't gate
                         (they stay in the report, marked suppressed)
  --ignore-view-line <regex>  Drop matching view lines before diffing
                         (repeatable; e.g. '^time "' for a build timestamp)
  --config <file>        a11y.config.json whose "defaults" seed unset flags
                         (auto-discovered in cwd)
  --no-config            Ignore an auto-discovered config
  -f, --format <fmt>     pretty | json | md               (default: pretty)
  -o, --output <file>    Write the report to a file
  -q, --quiet            Suppress progress
`,
    load: async () => (await import("./commands/diff.js")).diffCommand,
  },
};

const USAGE: Record<string, string> = {
  install: "install",
  audit: "audit <url...>",
  list: "list <cat> <url>",
  interact: "interact <url> --step",
  click: "click <url> --role",
  type: "type <url> --role",
  focus: "focus <url> --role",
  login: "login <url> --save",
  session: "session <subcommand>",
  snapshot: "snapshot [url...]",
  diff: "diff <base> <pr>",
};

export function rootHelp(): string {
  const labels = Object.keys(COMMANDS).map(
    (name) => `  ${USAGE[name] ?? `${name} <url>`}`,
  );
  const usageWidth = Math.max(...labels.map((l) => l.length));
  const lines = Object.entries(COMMANDS).map(
    ([name, spec]) =>
      `  ${USAGE[name] ?? `${name} <url>`}`.padEnd(usageWidth + 1) +
      spec.summary,
  );
  return `real-a11y — audit what a screen reader hears, from your shell

Usage: real-a11y <command> [target] [flags]

Commands:
${lines.join("\n")}

Run 'real-a11y <command> --help' for that command's flags.
Exit codes: 0 clean · 1 findings at/above --fail-on · 2 error
Docs: https://real-a11y.dev
`;
}

// ── validated flag views ─────────────────────────────────────────────────────

export function parseRules(
  value: string | boolean | undefined,
): A11yRule[] | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const wanted = value
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const valid: ReadonlySet<string> = new Set(ALL_RULES);
  for (const rule of wanted) {
    if (!valid.has(rule)) {
      throw new CliError(
        `unknown rule "${rule}". Valid rules: ${ALL_RULES.join(", ")}`,
      );
    }
  }
  return wanted as A11yRule[];
}

export function parseFailOn(
  value: string | boolean | undefined,
  fallback: FailOn,
): FailOn {
  if (value === undefined) return fallback;
  if (value === "error" || value === "warning" || value === "never") {
    return value;
  }
  throw new CliError(
    `--fail-on expects error, warning, or never — got "${String(value)}"`,
  );
}

export function parseFormat<T extends string>(
  value: string | boolean | undefined,
  allowed: readonly T[],
): T {
  if (value === undefined) return allowed[0];
  if ((allowed as readonly string[]).includes(String(value))) return value as T;
  throw new CliError(
    `--format expects ${allowed.join(" | ")} — got "${String(value)}"`,
  );
}

/**
 * Which producer builds a command's tree. `dom` injects the page-bundle and
 * walks the light DOM in the page; `native` reads Chromium's own accessibility
 * tree over CDP.
 *
 * This is no longer a choice a user makes — there is no `--producer` flag,
 * because each surface has exactly one correct producer. It stays as a
 * DESCRIPTION, because which producer a command reads is still the fact that
 * explains its shape: whole-document reach and no `--root` for native, a
 * scopable in-page walk for `tabs`.
 */
export type Producer = "dom" | "native";

/**
 * Commands that read Chromium's own accessibility tree — everything but
 * `tabs`, among those that build a tree at all.
 *
 * DERIVED from the command table, never hand-listed. A second copy of this
 * list is exactly the drift `docs/surface.json` exists to prevent, and it is
 * load-bearing: it tells a user who still types `--root` (or ships a config
 * `defaults.root`) why it no longer applies, instead of leaving the strict
 * parser to answer with "Unknown option".
 */
export function isNativeCommand(command: string): boolean {
  const producers = COMMANDS[command]?.producers;
  return producers !== undefined && producers.includes("native");
}

/** Every command that reads the native tree, for docs and error copy. */
export function nativeCommands(): string[] {
  return Object.keys(COMMANDS).filter(isNativeCommand);
}

const CHROME_CHANNELS = ["stable", "beta", "dev", "canary"] as const;

/** `undefined` when `--channel` wasn't passed at all — distinct from the
 * default "stable", so `install` can tell "bare invocation" (zero network,
 * trust the cache) apart from "explicitly asked to track stable" (re-checks
 * for a newer build). */
export function parseChannel(
  value: string | boolean | undefined,
): ChromeChannel | undefined {
  if (value === undefined) return undefined;
  if ((CHROME_CHANNELS as readonly string[]).includes(String(value))) {
    return value as ChromeChannel;
  }
  throw new CliError(
    `--channel expects ${CHROME_CHANNELS.join(" | ")} — got "${String(value)}"`,
  );
}

/** The report axis for `--only`; undefined = the full two-axis report. An enum
 * (not a boolean pair) so contradictory states are unrepresentable and a
 * config default is overridable from the command line. */
export type OnlyAxis = "findings" | "views";

export function parseOnly(
  value: string | boolean | undefined,
): OnlyAxis | undefined {
  if (value === undefined) return undefined;
  if (value === "findings" || value === "views") return value;
  throw new CliError(
    `--only expects findings | views — got "${String(value)}"`,
  );
}

export function parseMs(
  name: string,
  value: string | boolean | undefined,
  { fallback, max, min = 0 }: { fallback?: number; max: number; min?: number },
): number | undefined {
  if (value === undefined) return fallback;
  // Number("") === 0, so an empty value (e.g. --timeout=$UNSET_VAR) must be
  // rejected explicitly — for --timeout, 0 means "wait forever" in Playwright.
  const raw = String(value).trim();
  const n = Number(raw);
  if (raw === "" || !Number.isFinite(n) || !Number.isInteger(n) || n < min) {
    throw new CliError(
      `${name} expects an integer number of milliseconds${min > 0 ? ` (at least ${min})` : ""}`,
    );
  }
  return Math.min(n, max);
}

/**
 * How long to wait after each step before looking at the page again.
 *
 * A step's effect is not always there when the dispatch returns. A React state
 * update flushes on a later tick, a dialog mounts on the next frame, and a
 * navigation kicked off from a `setTimeout` hasn't even started yet — so an
 * immediate read reports "no changes" for a click that plainly did something.
 * `@real-a11y-dev/testing`'s `flow()` settles for the same reason and landed on
 * the same 200ms, which is cheap next to the ~1s a browser launch already costs.
 *
 * It also gates the NEXT step's targeting, not just the final diff: a step that
 * opens a menu has to have opened it before the step that clicks an item can
 * resolve that item against a fresh tree.
 *
 * This is a heuristic wait, not a synchronisation point — nothing can tell you a
 * page is *about* to navigate. Raise it for a slow app; `0` opts out.
 */
export function parseStepSettle(flags: FlagValues): number {
  return parseMs("--step-settle", flags["step-settle"], {
    fallback: DEFAULT_STEP_SETTLE_MS,
    max: 30_000,
  }) as number;
}

/** Long enough for a framework flush and a mount; short enough not to be felt. */
export const DEFAULT_STEP_SETTLE_MS = 200;

const WAIT_STATES = [
  "load",
  "domcontentloaded",
  "networkidle",
  "commit",
] as const;

/** Build the engine's OpenOptions from raw flags, validating each. */
export function parseOpenOptions(flags: FlagValues): OpenOptions {
  const options: OpenOptions = {};

  const wait = flags["wait-until"];
  if (wait !== undefined) {
    if (!(WAIT_STATES as readonly string[]).includes(String(wait))) {
      throw new CliError(
        `--wait-until expects ${WAIT_STATES.join(" | ")} — got "${String(wait)}"`,
      );
    }
    options.waitUntil = wait as OpenOptions["waitUntil"];
  }

  const settle = parseMs("--settle", flags.settle, { max: 30_000 });
  if (settle !== undefined) options.settleMs = settle;
  const timeout = parseMs("--timeout", flags.timeout, {
    max: 120_000,
    min: 1,
  });
  if (timeout !== undefined) options.timeoutMs = timeout;

  if (typeof flags.device === "string") options.device = flags.device;

  const viewport = flags.viewport;
  if (viewport !== undefined) {
    const match = /^(\d+)x(\d+)$/.exec(String(viewport));
    if (!match) {
      throw new CliError("--viewport expects WIDTHxHEIGHT, e.g. 1280x800");
    }
    options.viewport = {
      width: Number(match[1]),
      height: Number(match[2]),
    };
  }

  if (
    typeof flags.cdp === "string" &&
    (flags.headful || options.device || options.viewport)
  ) {
    throw new CliError(
      "--cdp reuses a running browser — it can't be combined with --headful, --device, or --viewport.",
    );
  }

  if (
    typeof flags.cdp === "string" &&
    typeof flags["chrome-path"] === "string"
  ) {
    throw new CliError(
      "--cdp reuses a running browser — it can't be combined with --chrome-path.",
    );
  }

  return options;
}

export function parseListCategory(value: string | undefined): ListCategory {
  if (value && (LIST_CATEGORIES as readonly string[]).includes(value)) {
    return value as ListCategory;
  }
  throw new CliError(
    `list expects a category first: ${LIST_CATEGORIES.join(", ")}`,
    "usage: real-a11y list <category> <url>",
  );
}
