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

import {
  HELP_INSTALL,
  HELP_AUDIT,
  HELP_INSPECT,
  HELP_TREE,
  HELP_OUTLINE,
  HELP_TABS,
  HELP_LIST,
  HELP_INTERACT,
  HELP_CLICK,
  HELP_TYPE,
  HELP_FOCUS,
  HELP_LOGIN,
  HELP_SESSION,
  HELP_SNAPSHOT,
  HELP_DIFF,
} from "./command-help.js";
import { CliError, type FailOn } from "./exit.js";
import {
  AUDIT_FLAGS,
  INSPECT_FLAGS,
  VIEW_FLAGS,
  TABS_FLAGS,
  INTERACT_FLAGS,
  ACT_FLAGS,
  INSTALL_FLAGS,
  LOGIN_FLAGS,
  SESSION_FLAGS,
  SNAPSHOT_FLAGS,
  DIFF_FLAGS,
  LIST_CATEGORIES,
  type ListCategory,
} from "./flag-tables.js";

/**
 * A parsed flag value.
 *
 * `string[]` is not optional decoration: `audit-origin`, `step` and
 * `ignore-view-line` are declared `multiple: true`, so `node:util.parseArgs`
 * hands back an array for them and always has. The type said otherwise, which
 * made every `Array.isArray(flags[…])` guard in the commands look like dead
 * code to a reader and to the compiler — while being the branch that actually
 * fires at runtime.
 *
 * Nothing caught it because the tests that pass real array values were the
 * files excluded from typecheck.
 */
export type FlagValue = string | string[] | boolean | undefined;
export type FlagValues = Record<string, FlagValue>;
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

export { LIST_CATEGORIES, type ListCategory };

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
    help: HELP_INSTALL,
    load: async () => (await import("./commands/install.js")).installCommand,
  },
  audit: {
    summary: "Violations (rule · severity · locator); exits 1 on errors",
    group: "audit",
    producers: ["native"],
    options: AUDIT_FLAGS,
    help: HELP_AUDIT,
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
    help: HELP_INSPECT,
    load: async () => (await import("./commands/inspect.js")).inspectCommand,
  },
  tree: {
    summary: "Semantic tree (role + accessible name)",
    group: "view",
    producers: ["native"],
    options: VIEW_FLAGS,
    help: HELP_TREE,
    load: async () => (await import("./commands/views.js")).treeCommand,
  },
  outline: {
    summary: "Heading outline (h1–h6)",
    group: "view",
    producers: ["native"],
    options: VIEW_FLAGS,
    help: HELP_OUTLINE,
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
    help: HELP_TABS,
    load: async () => (await import("./commands/views.js")).tabsCommand,
  },
  list: {
    summary: "One category: heading|link|button|form|landmark|image",
    group: "view",
    // `listByRole` runs over a native ExtractionResult just as well as over an
    // Element, so this lists from the same tree `tree` and `audit` read.
    producers: ["native"],
    options: VIEW_FLAGS,
    help: HELP_LIST,
    load: async () => (await import("./commands/views.js")).listCommand,
  },
  interact: {
    summary: "Run steps on a page, then show what they changed",
    group: "act",
    producers: ["native"],
    options: INTERACT_FLAGS,
    help: HELP_INTERACT,
    load: async () => (await import("./commands/interact.js")).interactCommand,
  },
  click: {
    summary: "Click one element by role + accessible name",
    group: "act",
    producers: ["native"],
    options: ACT_FLAGS,
    help: HELP_CLICK,
    load: async () => (await import("./commands/interact.js")).clickCommand,
  },
  type: {
    summary: "Set a text field's value by role + accessible name",
    group: "act",
    producers: ["native"],
    options: ACT_FLAGS,
    help: HELP_TYPE,
    load: async () => (await import("./commands/interact.js")).typeCommand,
  },
  focus: {
    summary: "Move real keyboard focus by role + accessible name",
    group: "act",
    producers: ["native"],
    options: ACT_FLAGS,
    help: HELP_FOCUS,
    load: async () => (await import("./commands/interact.js")).focusCommand,
  },
  login: {
    summary: "Save a login session for --storage-state audits",
    group: "setup",
    producers: [],
    options: LOGIN_FLAGS,
    help: HELP_LOGIN,
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
    help: HELP_SESSION,
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
    help: HELP_SNAPSHOT,
    load: async () => (await import("./commands/snapshot.js")).snapshotCommand,
  },
  diff: {
    summary: "Findings-aware diff of two snapshot artifacts",
    group: "artifact",
    // Pure: two artifacts in, no page, no tree to produce.
    producers: [],
    options: DIFF_FLAGS,
    help: HELP_DIFF,
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

export function parseRules(value: FlagValue): A11yRule[] | undefined {
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

export function parseFailOn(value: FlagValue, fallback: FailOn): FailOn {
  if (value === undefined) return fallback;
  if (value === "error" || value === "warning" || value === "never") {
    return value;
  }
  throw new CliError(
    `--fail-on expects error, warning, or never — got "${String(value)}"`,
  );
}

export function parseFormat<T extends string>(
  value: FlagValue,
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
export function parseChannel(value: FlagValue): ChromeChannel | undefined {
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

export function parseOnly(value: FlagValue): OnlyAxis | undefined {
  if (value === undefined) return undefined;
  if (value === "findings" || value === "views") return value;
  throw new CliError(
    `--only expects findings | views — got "${String(value)}"`,
  );
}

export function parseMs(
  name: string,
  value: FlagValue,
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

/**
 * How a run treats what users entered into the page (ADR-0001).
 *
 * `redactInput` is the strict mode (`--redact-input`, config
 * `defaults.redactInput`): the tree carries no field value and no rich-text
 * editor content at all. Otherwise a LIVE view prints each field's value the
 * way a screen reader announces it, sensitive fields as `[redacted]` —
 * `liveValues` is what the live views pass to the serializers. Persisted
 * outputs (`snapshot`) don't read `liveValues`; they opt in with `--values`.
 */
export function inputPolicy(flags: FlagValues): {
  redactInput: boolean;
  liveValues: boolean;
} {
  const redactInput = flags["redact-input"] === true;
  return { redactInput, liveValues: !redactInput };
}

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
