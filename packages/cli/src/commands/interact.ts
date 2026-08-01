/**
 * `interact` — drive a page, then show what the interaction changed for a
 * screen reader. Plus the one-step sugar verbs `click` / `type` / `focus`.
 *
 * The loop mirrors the MCP server's: checkpoint the tree, act, diff — all three
 * against **Chromium's own** accessibility tree, one producer end to end.
 *
 * Targeting is role + accessible name only: if a control can't be reached that
 * way, assistive tech can't reach it either, and that's a finding rather than a
 * targeting inconvenience. The diff is written in the same vocabulary the
 * targeting uses, so a node named one thing when you aim at it can't come back
 * named another in the report.
 *
 * The checkpoint lives here in Node rather than in the page, so a step that
 * navigates doesn't destroy it — the run detects the replaced document and says
 * so (reported, not thrown), instead of surfacing a missing-checkpoint error.
 *
 * Chromium only — the action backend is CDP.
 */

import type { BrowserSession } from "@real-a11y-dev/browser";
import {
  captureNativeCheckpoint,
  diffNativeCheckpoint,
  type TargetCandidate,
} from "@real-a11y-dev/browser";
import { redactUrl } from "@real-a11y-dev/snapshot";

import {
  parseFormat,
  parseStepSettle,
  type CommandFn,
  type FlagValues,
} from "../args.js";
import { CliError, EXIT } from "../exit.js";
import {
  describeStep,
  parseStep,
  type InteractStep,
  type StepVerb,
} from "../interact-step.js";
import { progress, writeReport } from "../output.js";
import { renderJson, type PageReport } from "../render/json.js";
import { createSession } from "../session.js";

import {
  ensurePageOpen,
  outputOf,
  sessionFlags,
  singleTarget,
  type Target,
} from "./common.js";

type Session = Awaited<ReturnType<typeof createSession>>;

/** How many ambiguity candidates to print before summarizing the rest. */
const MAX_CANDIDATES = 10;

const describeTarget = (c: TargetCandidate): string => `${c.role} "${c.name}"`;

/** Read the repeatable `--step` flag into validated steps. */
export function stepsFromFlags(flags: FlagValues): InteractStep[] {
  const raw = flags.step;
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? [raw]
      : [];
  if (values.length === 0) {
    throw new CliError(
      "interact needs at least one --step",
      `e.g. real-a11y interact <url> --step 'click button "Save"'`,
    );
  }
  return values.map((value) => parseStep(String(value)));
}

/**
 * Resolve one step's target against a FRESH native tree and dispatch it.
 *
 * The tree is re-read per step because the previous step may have changed the
 * page — resolving once up front would act on stale nodes. Node ids never
 * leave this function.
 */
async function runStep(session: Session, step: InteractStep): Promise<void> {
  const { resolveTarget } = await import("@real-a11y-dev/browser");
  const tree = await session.nativeTree();
  const resolved = resolveTarget(tree, {
    role: step.role,
    ...(step.name === undefined ? {} : { name: step.name }),
    ...(step.nth === undefined ? {} : { nth: step.nth }),
  });

  const label = `${step.role}${step.name === undefined ? "" : ` "${step.name}"`}`;

  switch (resolved.kind) {
    case "not-found":
      throw new CliError(
        `no ${label} in the page's accessibility tree`,
        // Always point at `tree`: it reads the same tree targeting resolves
        // against, so it's the one view that can't disagree with the refusal.
        // (`list` takes categories, not roles, so it can't name an arbitrary
        // role here without being wrong for most of them.)
        resolved.matchesForRole > 0
          ? `${resolved.matchesForRole} ${step.role}(s) are present under a different name — see them with: real-a11y tree <url>`
          : `check what the page actually exposes: real-a11y tree <url>`,
      );
    case "nth-out-of-range":
      throw new CliError(
        `nth=${resolved.nth}, but only ${resolved.matchCount} node(s) match ${label}`,
      );
    case "ambiguous": {
      const shown = resolved.candidates.slice(0, MAX_CANDIDATES);
      const lines = shown.map(
        (c) =>
          `    nth=${c.nth} · ${describeTarget(c)}${c.disabled ? " (disabled)" : ""}`,
      );
      const more = resolved.candidates.length - shown.length;
      if (more > 0) lines.push(`    … +${more} more`);
      throw new CliError(
        `${resolved.candidates.length} nodes match ${label}:\n${lines.join("\n")}`,
        "add nth=<n> to the step (1-based, document order)",
      );
    }
    case "no-dom-node":
      throw new CliError(
        `matched ${describeTarget(resolved.candidate)}, but it has no backing DOM element (a synthesized node) — it can't be acted on`,
      );
    case "resolved":
      break;
  }

  if (resolved.candidate.disabled) {
    // A disabled control swallows the action silently — the dispatch would
    // "succeed" and change nothing, so the diff would be empty and the report
    // would be a lie. Refuse with the cause instead.
    throw new CliError(
      `${describeTarget(resolved.candidate)} is disabled — the page would ignore the ${step.verb}`,
      "act on whatever enables it first, if that's the point of the flow",
    );
  }

  const result = await session.act({
    nodeId: resolved.nodeId,
    action: step.verb,
    ...(step.text === undefined ? {} : { payload: { value: step.text } }),
  });

  if (!result.success) {
    // The backend's "re-read the tree and retry" remedy presumes a caller
    // holding node ids; here resolution happened microseconds ago, so a miss
    // means the page mutated mid-step.
    if (
      result.error !== undefined &&
      /could not resolve node/.test(result.error)
    ) {
      throw new CliError(
        `the target changed or disappeared mid-step — the page mutated while acting on ${label}`,
        "re-run; if it's a race with an animation, add --settle <ms>",
      );
    }
    throw new CliError(
      `could not ${step.verb} ${label}: ${result.error ?? "the action failed"}`,
    );
  }
}

interface InteractOutcome {
  steps: string[];
  diff: string;
  navigated: boolean;
}

/**
 * Give the page time to react before looking at it again.
 *
 * A dispatch returning is not the same as its effect having landed: a React
 * state update flushes on a later tick, a dialog mounts on the next frame. This
 * gates the NEXT step's targeting as much as the final diff — a step that opens
 * a menu has to have opened it before the step that clicks an item can resolve
 * that item.
 */
const MAX_SETTLE_MS = 30_000;

const settle = (ms: number): Promise<void> => {
  const safeMs = Math.max(0, Math.min(ms, MAX_SETTLE_MS));
  return safeMs > 0
    ? new Promise((resolve) => setTimeout(resolve, safeMs))
    : Promise.resolve();
};

async function interactOnPage(
  session: Session,
  steps: readonly InteractStep[],
  stepSettleMs: number,
  quiet: boolean,
): Promise<InteractOutcome> {
  const before = captureNativeCheckpoint(
    await session.nativeTree(),
    session.currentUrl() ?? "",
  );

  const done: string[] = [];
  for (const step of steps) {
    await runStep(session, step);
    await settle(stepSettleMs);
    const rendered = describeStep(step);
    done.push(rendered);
    progress(`  ✓ ${rendered}`, { quiet });
  }

  const outcome = diffNativeCheckpoint(
    before,
    await session.nativeTree(),
    session.currentUrl() ?? "",
  );

  // A step that navigates is an expected outcome of a real click, not a failure
  // of the run — report it and keep the exit code clean. The checkpoint itself
  // survived (it lives here, not in the page); what didn't survive is the node
  // identity it was written in, so there is nothing left to compare against.
  if (outcome.kind === "replaced") {
    return {
      steps: done,
      diff:
        "A step navigated (or reloaded) the page, so the tree captured before the steps describes a document that no longer exists — no diff available.\n" +
        `Inspect where it landed with: real-a11y tree ${redactUrl(outcome.to)}`,
      navigated: true,
    };
  }

  return {
    steps: done,
    diff: outcome.changed
      ? outcome.rendered
      : "No tree changes since the steps ran.",
    navigated: false,
  };
}

/**
 * Core body for `interact` and the one-step sugar verbs, run against a session
 * the caller already owns.  The caller opens and closes the session — this is
 * what both the one-shot CLI commands and the session daemon use.
 */
export async function runInteractStepsOnSession(
  session: BrowserSession,
  steps: readonly InteractStep[],
  positionals: string[],
  flags: FlagValues,
): Promise<number> {
  const format = parseFormat(flags.format, ["pretty", "json"] as const);
  const target: Target = singleTarget(positionals, flags, "interact");
  const output = outputOf(flags);
  const quiet = flags.quiet === true;
  const stepSettleMs = parseStepSettle(flags);

  progress(`opening ${target.name} …`, { quiet });
  const opened = await ensurePageOpen(session, target, flags);
  const outcome = await interactOnPage(session, steps, stepSettleMs, quiet);
  // Re-read AFTER the steps: a click can navigate, and `url` is contracted
  // as the final address. Reading it before acting reports where the run
  // started, which is wrong in exactly the case the report flags as a
  // navigation. Falls back to the opened URL if the page is already gone.
  const finalUrl = redactUrl(session.currentUrl() ?? opened.url);

  if (format === "json") {
    const page: PageReport = {
      name: target.name,
      url: finalUrl,
      findings: [],
      // R1: `steps` carries the rendered form, which never includes typed text.
      steps: outcome.steps,
      diff: outcome.diff,
      // Machine-readable signal that a step navigated, so a consumer doesn't
      // have to string-match the diff prose to learn the checkpoint was lost
      // (and that `url` differs from the address the run opened).
      navigated: outcome.navigated,
    };
    writeReport(output, renderJson("interact", [page]));
  } else {
    const body = outcome.diff.endsWith("\n")
      ? outcome.diff
      : `${outcome.diff}\n`;
    writeReport(output, body);
  }
  return EXIT.OK;
}

export async function runInteractOnSession(
  session: BrowserSession,
  positionals: string[],
  flags: FlagValues,
): Promise<number> {
  const steps = stepsFromFlags(flags);
  return runInteractStepsOnSession(session, steps, positionals, flags);
}

export const interactCommand: CommandFn = async (positionals, flags) => {
  const target = singleTarget(positionals, flags, "interact");
  const session = await createSession(sessionFlags(flags, [target]));
  try {
    return await runInteractOnSession(session, positionals, flags);
  } finally {
    await session.close();
  }
};

/**
 * Build the single step behind a sugar verb. `--name` is optional in the same
 * way the step language's quoted name is: omitted matches any name, and an
 * explicit empty string targets an unlabeled control.
 */
export function sugarStep(verb: StepVerb, flags: FlagValues): InteractStep {
  const role = flags.role;
  if (typeof role !== "string" || role.trim() === "") {
    throw new CliError(
      `${verb} needs --role`,
      `e.g. real-a11y ${verb} <url> --role button --name "Save"`,
    );
  }
  const name = flags.name;
  const nthRaw = flags.nth;
  let nth: number | undefined;
  if (typeof nthRaw === "string") {
    if (!/^[0-9]+$/.test(nthRaw) || Number(nthRaw) < 1) {
      throw new CliError(
        `--nth must be a positive whole number (1-based) — got "${nthRaw}"`,
      );
    }
    nth = Number(nthRaw);
  }
  const text = flags.text;
  if (verb === "type") {
    if (typeof text !== "string" || text === "") {
      throw new CliError(
        "type needs --text",
        `e.g. real-a11y type <url> --role textbox --name "Email" --text you@example.com`,
      );
    }
  } else if (typeof text === "string") {
    throw new CliError(`--text applies to \`type\`, not \`${verb}\``);
  }

  return {
    verb,
    role: role.trim(),
    ...(typeof name === "string" ? { name } : {}),
    ...(nth === undefined ? {} : { nth }),
    ...(verb === "type" ? { text: text as string } : {}),
  };
}

export async function runClickOnSession(
  session: BrowserSession,
  positionals: string[],
  flags: FlagValues,
): Promise<number> {
  const step = sugarStep("click", flags);
  return runInteractStepsOnSession(session, [step], positionals, flags);
}

export async function runTypeOnSession(
  session: BrowserSession,
  positionals: string[],
  flags: FlagValues,
): Promise<number> {
  const step = sugarStep("type", flags);
  return runInteractStepsOnSession(session, [step], positionals, flags);
}

export async function runFocusOnSession(
  session: BrowserSession,
  positionals: string[],
  flags: FlagValues,
): Promise<number> {
  const step = sugarStep("focus", flags);
  return runInteractStepsOnSession(session, [step], positionals, flags);
}

function sugar(
  verb: StepVerb,
  runner: (
    session: BrowserSession,
    positionals: string[],
    flags: FlagValues,
  ) => Promise<number>,
): CommandFn {
  return async (positionals, flags) => {
    const target = singleTarget(positionals, flags, verb);
    const session = await createSession(sessionFlags(flags, [target]));
    try {
      return await runner(session, positionals, flags);
    } finally {
      await session.close();
    }
  };
}

export const clickCommand = sugar("click", runClickOnSession);
export const typeCommand = sugar("type", runTypeOnSession);
export const focusCommand = sugar("focus", runFocusOnSession);
