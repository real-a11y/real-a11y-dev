/**
 * `interact` — drive a page, then show what the interaction changed for a
 * screen reader. Plus the one-step sugar verbs `click` / `type` / `focus`.
 *
 * The loop mirrors the MCP server's: checkpoint the tree, act, diff. The two
 * halves deliberately use different producers, and it's worth knowing which:
 *
 *   • **Acting** resolves role + accessible name against **Chromium's own**
 *     accessibility tree and dispatches over CDP. Targeting is role+name only
 *     — if a control can't be reached that way, assistive tech can't reach it
 *     either, and that's a finding rather than a targeting inconvenience.
 *   • **The diff** is the in-page DOM walk's tree checkpoint, which is what
 *     `--root` scopes. It is bound to the page instance, so a step that
 *     navigates discards it (reported, not thrown).
 *
 * Chromium only — the action backend is CDP.
 */

import type { TargetCandidate } from "@real-a11y-dev/browser";
import { redactUrl } from "@real-a11y-dev/snapshot";

import {
  parseFormat,
  parseOpenOptions,
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
import { callPage, createSession, openPage } from "../session.js";

import {
  isAuthenticated,
  outputOf,
  rootOf,
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
        // Always point at the native tree: that is precisely what targeting
        // resolves against, so it's the one view that can't disagree with the
        // refusal. (`list` takes categories, not roles, so it can't name an
        // arbitrary role here without being wrong for most of them.)
        resolved.matchesForRole > 0
          ? `${resolved.matchesForRole} ${step.role}(s) are present under a different name — see them with: real-a11y tree <url> --producer native`
          : `check what the page actually exposes: real-a11y tree <url> --producer native`,
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

/** What `diffSinceCheckpoint` renders when the checkpoint didn't survive. */
const CHECKPOINT_GONE = /No tree checkpoint on this page/;

interface InteractOutcome {
  steps: string[];
  diff: string;
  navigated: boolean;
}

async function interactOnPage(
  session: Session,
  root: string,
  steps: readonly InteractStep[],
  quiet: boolean,
): Promise<InteractOutcome> {
  await callPage<string>(session, "checkpointTree", root, []);

  const done: string[] = [];
  for (const step of steps) {
    await runStep(session, step);
    const rendered = describeStep(step);
    done.push(rendered);
    progress(`  ✓ ${rendered}`, { quiet });
  }

  try {
    return {
      steps: done,
      diff: await callPage<string>(session, "diffSinceCheckpoint", root, []),
      navigated: false,
    };
  } catch (err) {
    // A step that navigates replaces the page's bundle instance, taking the
    // checkpoint with it. That's an expected outcome of a real click, not a
    // failure of the run — report it and keep the exit code clean.
    const message = err instanceof Error ? err.message : String(err);
    if (CHECKPOINT_GONE.test(message)) {
      return {
        steps: done,
        diff:
          "The page navigated, so the tree checkpoint from before the steps was discarded — no diff available.\n" +
          "Inspect the page it landed on with: real-a11y tree <url>",
        navigated: true,
      };
    }
    throw err;
  }
}

/** Shared body for `interact` and the one-step sugar verbs. */
async function runInteract(
  command: string,
  steps: readonly InteractStep[],
  positionals: string[],
  flags: FlagValues,
): Promise<number> {
  const format = parseFormat(flags.format, ["pretty", "json"] as const);
  const target: Target = singleTarget(positionals, flags, command);
  const output = outputOf(flags);
  const root = rootOf(flags);
  const quiet = flags.quiet === true;
  const openOptions = parseOpenOptions(flags);

  const session = await createSession(sessionFlags(flags, [target]));
  let outcome: InteractOutcome;
  let finalUrl: string;
  try {
    progress(`opening ${target.name} …`, { quiet });
    const opened = await openPage(
      session,
      target.url,
      openOptions,
      target.fileApproved,
      isAuthenticated(flags),
    );
    finalUrl = redactUrl(opened.url);
    outcome = await interactOnPage(session, root, steps, quiet);
    // Re-read AFTER the steps: a click can navigate, and `url` is contracted
    // as the final address. Reading it before acting reports where the run
    // started, which is wrong in exactly the case the report flags as a
    // navigation. Falls back to the opened URL if the page is already gone.
    finalUrl = redactUrl(session.currentUrl() ?? opened.url);
  } finally {
    await session.close();
  }

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
    writeReport(output, renderJson(command, [page]));
  } else {
    const body = outcome.diff.endsWith("\n")
      ? outcome.diff
      : `${outcome.diff}\n`;
    writeReport(output, body);
  }
  return EXIT.OK;
}

export const interactCommand: CommandFn = async (positionals, flags) =>
  runInteract("interact", stepsFromFlags(flags), positionals, flags);

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

function sugar(verb: StepVerb): CommandFn {
  return async (positionals, flags) =>
    runInteract(verb, [sugarStep(verb, flags)], positionals, flags);
}

export const clickCommand = sugar("click");
export const typeCommand = sugar("type");
export const focusCommand = sugar("focus");
