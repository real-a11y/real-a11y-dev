/**
 * Per-command `--help` text. Split out of `args.ts`, whose command table
 * refers to these by name; the text itself is unchanged.
 */

import { ALL_RULES } from "@real-a11y-dev/audit";

import {
  LIST_CATEGORIES,
  SHARED_FLAG_HELP_NO_ROOT,
  SHARED_FLAG_HELP_ROOT,
} from "./flag-tables.js";

export const HELP_INSTALL = `Usage: real-a11y install [flags]

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
`;

export const HELP_AUDIT = `Usage: real-a11y audit <url...> [flags]

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
`;

export const HELP_INSPECT = `Usage: real-a11y inspect <url> [flags]

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
`;

export const HELP_TREE = `Usage: real-a11y tree <url> [flags]

Print the semantic tree — what a screen reader perceives, role by role. Read
from Chromium's own accessibility tree (whole document, so no --root; reaches
user-agent-shadow media controls an in-page walk never sees).

A field prints what it holds, the way a screen reader announces it:
textbox "Email" = "jane@x.com". A password, one-time code or payment field
reads "[redacted]"; --redact-input withholds every value and all rich-text
editor content.

Flags:
  --include-generic      Include generic container nodes
${SHARED_FLAG_HELP_NO_ROOT}
`;

export const HELP_OUTLINE = `Usage: real-a11y outline <url> [flags]

Print the heading outline, derived from Chromium's own accessibility tree
(whole document, so no --root).

Flags:
${SHARED_FLAG_HELP_NO_ROOT}
`;

export const HELP_TABS = `Usage: real-a11y tabs <url> [flags]

Print every focusable element in Tab order.

The only command still built from the in-page DOM walk, and the only one that
takes --root. Chromium's accessibility tree knows whether a node is focusable,
but not the SEQUENCE — tabindex never reaches it — so tab order is DOM work by
nature, not a fallback.

Each stop shows its field value; a password, one-time code or payment field
reads "[redacted]". --redact-input drops the values, and a stop whose name
would carry text typed into a rich-text editor reads "[redacted]", as in
tree. A link typed into a rich-text editor is not a Tab stop, so it never
appears here; a
contenteditable="false" island such as a mention chip is one, and keeps its
name.

Flags:
${SHARED_FLAG_HELP_ROOT}
`;

export const HELP_LIST = `Usage: real-a11y list <category> <url> [flags]

List every element in one category with role, accessible name, and locator,
from Chromium's own accessibility tree (whole document, so no --root).
Categories: ${LIST_CATEGORIES.join(", ")}

Flags:
${SHARED_FLAG_HELP_NO_ROOT}
`;

export const HELP_INTERACT = `Usage: real-a11y interact <url> --step '<step>' [--step '<step>' …]

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

The text a step types is never echoed: the step prints as '= ‹hidden›', in
progress output and in --format json alike. The diff then shows what the field
holds, the way a screen reader announces it — a11y.value (unset) → "…" — with
a password, one-time code or payment field as "[redacted]". --redact-input
withholds every field value and all rich-text editor content from the diff.
Don't use this to log in: a password on the command line is visible to other
processes and lands in your shell history. Use 'real-a11y login' instead.

Chromium only.

Flags:
  --step '<step>'        A step to run (repeatable, ordered)   (required)
  --step-settle <ms>     Wait after each step before looking     (default: 200)
${SHARED_FLAG_HELP_NO_ROOT}
`;

export const HELP_CLICK = `Usage: real-a11y click <url> --role <role> [--name "<name>"] [flags]

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
`;

export const HELP_TYPE = `Usage: real-a11y type <url> --role <role> --name "<name>" --text <value>

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

The --text you pass is never echoed back — not in progress output, not in
--format json. The diff shows what the field then holds, as a screen reader
would announce it (a password field as "[redacted]"; every field withheld
under --redact-input).
Don't use this to log in: a password on the command line is visible to other
processes and lands in your shell history. Use 'real-a11y login' instead.

Flags:
  --role <role>          ARIA role as the tree prints it       (required)
  --name <name>          Accessible name; omit to match any, "" for unlabeled
  --text <value>         The text to enter                     (required)
  --nth <n>              1-based pick among matches, document order
  --step-settle <ms>     Wait after the action before looking    (default: 200)
${SHARED_FLAG_HELP_NO_ROOT}
`;

export const HELP_FOCUS = `Usage: real-a11y focus <url> --role <role> [--name "<name>"] [flags]

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
`;

export const HELP_LOGIN = `Usage: real-a11y login <url> --save <file>

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
`;

export const HELP_SESSION = `Usage: real-a11y session <list|stop|stop-all> [flags]

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
`;

export const HELP_SNAPSHOT = `Usage: real-a11y snapshot [url...] [flags]

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
  --values               Include field values in the tree view (off by
                         default: an artifact is committed and posted)
  --baseline <file>      Suppress findings this baseline accepts (kept in the
                         report, out of the --fail-on count and sarif)
  --update-baseline      Rewrite the baseline from the current findings, then
                         stop (writes .a11y-baseline.json, or --baseline's path)
  --fail-on <level>      Gate on unsuppressed findings: error | warning | never
                         (default: never — snapshot just writes the artifact)
  -o, --output <file>    Where to write (default: A11Y_SNAPSHOT_OUT or stdout)
${SHARED_FLAG_HELP_NO_ROOT}
`;

export const HELP_DIFF = `Usage: real-a11y diff <base.json> <pr.json> [flags]

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
`;
