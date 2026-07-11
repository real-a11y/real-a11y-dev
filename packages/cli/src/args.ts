/**
 * Command table, flag schemas, and help text. Flags are parsed by
 * `node:util.parseArgs` (strict); this module owns everything the parser
 * needs plus the validated typed views over its output.
 *
 * Help text is hand-written and lists only *shipped* commands/formats — a
 * flag the help advertises must never be an unimplemented error.
 */

import type { ParseArgsConfig } from "node:util";

import type { OpenOptions } from "@real-a11y-dev/mcp/browser";
import { ALL_RULES, type A11yRule } from "@real-a11y-dev/testing";

import { CliError, type FailOn } from "./exit.js";

export type FlagValues = Record<string, string | boolean | undefined>;
export type CommandFn = (
  positionals: string[],
  flags: FlagValues,
) => Promise<number>;

type Options = NonNullable<ParseArgsConfig["options"]>;

const BROWSER_FLAGS: Options = {
  root: { type: "string" },
  device: { type: "string" },
  viewport: { type: "string" },
  "wait-until": { type: "string" },
  settle: { type: "string" },
  timeout: { type: "string" },
  headful: { type: "boolean" },
  cdp: { type: "string" },
  "allow-file": { type: "boolean" },
};

const OUTPUT_FLAGS: Options = {
  format: { type: "string", short: "f" },
  output: { type: "string", short: "o" },
  quiet: { type: "boolean", short: "q" },
  verbose: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

const AUDIT_FLAGS: Options = {
  ...BROWSER_FLAGS,
  ...OUTPUT_FLAGS,
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
  ...BROWSER_FLAGS,
  ...OUTPUT_FLAGS,
  "include-generic": { type: "boolean" },
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

const SHARED_FLAG_HELP = `  --root <selector>      Scope extraction                 (default: body)
  --device <name>        Emulate a device, e.g. "iPhone 13"
  --viewport <WxH>       e.g. 1280x800
  --wait-until <state>   load|domcontentloaded|networkidle|commit (default: load)
  --settle <ms>          Extra wait after load            (default: 0)
  --timeout <ms>         Navigation timeout               (default: 30000)
  -f, --format <fmt>     pretty | json                    (default: pretty)
  -o, --output <file>    Write the report to a file (progress stays on stderr)
  --headful              Show the browser window
  --cdp <endpoint>       Attach to a running Chrome — also the way to audit
                         pages behind a login (no emulation flags over CDP)
  -q, --quiet            Suppress progress
  --verbose              Extra diagnostics on stderr`;

export interface CommandSpec {
  summary: string;
  options: Options;
  help: string;
  load: () => Promise<CommandFn>;
}

export const COMMANDS: Record<string, CommandSpec> = {
  audit: {
    summary: "Violations (rule · severity · locator); exits 1 on errors",
    options: AUDIT_FLAGS,
    help: `Usage: real-a11y audit <url...> [flags]

Audit pages against the semantic-tree rules; print violations grouped by
rule. Exits 1 on errors by default — a CI gate with no extra flags.

Examples:
  real-a11y audit http://localhost:3000
  real-a11y audit https://stage.example.com --device "iPhone 13" --fail-on warning
  real-a11y audit ./dist/index.html --format json -o report.json

Flags:
  --rules <ids>          Comma-separated subset of: ${ALL_RULES.join(", ")}
  --fail-on <level>      error | warning | never          (default: error)
  --no-annotate          Skip GitHub Actions annotations
${SHARED_FLAG_HELP}

Findings go to stdout; progress and errors go to stderr.
`,
    load: async () => (await import("./commands/audit.js")).auditCommand,
  },
  inspect: {
    summary: "Findings + tree + outline + tab order in one pass",
    options: INSPECT_FLAGS,
    help: `Usage: real-a11y inspect <url> [flags]

Findings plus semantic tree, heading outline, and tab order — all derived
from one extraction, so the views can never disagree.

Flags:
  --rules <ids>          Comma-separated subset of: ${ALL_RULES.join(", ")}
  --fail-on <level>      error | warning | never          (default: error)
  --include-generic      Include generic container nodes in the tree
${SHARED_FLAG_HELP}
`,
    load: async () => (await import("./commands/inspect.js")).inspectCommand,
  },
  tree: {
    summary: "Semantic tree (role + accessible name)",
    options: VIEW_FLAGS,
    help: `Usage: real-a11y tree <url> [flags]

Print the semantic tree — what a screen reader perceives, role by role.

Flags:
  --include-generic      Include generic container nodes
${SHARED_FLAG_HELP}
`,
    load: async () => (await import("./commands/views.js")).treeCommand,
  },
  outline: {
    summary: "Heading outline (h1–h6)",
    options: VIEW_FLAGS,
    help: `Usage: real-a11y outline <url> [flags]

Print the heading outline.

Flags:
${SHARED_FLAG_HELP}
`,
    load: async () => (await import("./commands/views.js")).outlineCommand,
  },
  tabs: {
    summary: "Focusable elements in Tab order",
    options: VIEW_FLAGS,
    help: `Usage: real-a11y tabs <url> [flags]

Print every focusable element in Tab order.

Flags:
${SHARED_FLAG_HELP}
`,
    load: async () => (await import("./commands/views.js")).tabsCommand,
  },
  list: {
    summary: "One category: heading|link|button|form|landmark|image",
    options: VIEW_FLAGS,
    help: `Usage: real-a11y list <category> <url> [flags]

List every element in one category with role, accessible name, and locator.
Categories: ${LIST_CATEGORIES.join(", ")}

Flags:
${SHARED_FLAG_HELP}
`,
    load: async () => (await import("./commands/views.js")).listCommand,
  },
};

export function rootHelp(): string {
  const lines = Object.entries(COMMANDS).map(
    ([name, spec]) =>
      `  ${name === "list" ? "list <cat> <url>" : `${name} <url${name === "audit" ? "..." : ""}>`}`.padEnd(21) + spec.summary,
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

export function parseRules(value: string | boolean | undefined): A11yRule[] | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const wanted = value.split(",").map((r) => r.trim()).filter(Boolean);
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

function parseMs(
  name: string,
  value: string | boolean | undefined,
  { fallback, max }: { fallback?: number; max: number },
): number | undefined {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new CliError(`${name} expects a non-negative integer (milliseconds)`);
  }
  return Math.min(n, max);
}

const WAIT_STATES = ["load", "domcontentloaded", "networkidle", "commit"] as const;

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
  const timeout = parseMs("--timeout", flags.timeout, { max: 120_000 });
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

  if (typeof flags.cdp === "string" && (flags.headful || options.device || options.viewport)) {
    throw new CliError(
      "--cdp reuses a running browser — it can't be combined with --headful, --device, or --viewport.",
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
