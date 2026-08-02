/**
 * Daemon-side command dispatch against a live session.
 */

import type { BrowserSession } from "@real-a11y-dev/browser";

import {
  parseFormat,
  parseListCategory,
  parseOpenOptions,
  type FlagValues,
} from "../args.js";
import { runAuditOnSession, validateAudit } from "../commands/audit.js";
import {
  outputOf,
  resolveAuditTargets,
  singleTarget,
  type Target,
} from "../commands/common.js";
import { runInspectOnSession, validateInspect } from "../commands/inspect.js";
import {
  runClickOnSession,
  runFocusOnSession,
  runInteractOnSession,
  runTypeOnSession,
  validateInteract,
} from "../commands/interact.js";
import {
  resolveSnapshotTargets,
  runSnapshotOnSession,
  validateSnapshot,
} from "../commands/snapshot.js";
import {
  runListOnSession,
  runOutlineOnSession,
  runTabsOnSession,
  runTreeOnSession,
} from "../commands/views.js";

/**
 * Fail fast on invalid flags / missing pages before the daemon spawns a browser.
 * Mirrors the validation moved into the one-shot command wrappers.
 */
export function validateCommand(
  command: string,
  positionals: string[],
  flags: FlagValues,
): void {
  switch (command) {
    case "audit":
      validateAudit(positionals, flags);
      return;
    case "inspect":
      validateInspect(positionals, flags);
      return;
    case "snapshot":
      validateSnapshot(positionals, flags);
      return;
    case "list":
      parseListCategory(positionals[0]);
      parseFormat(flags.format, ["pretty", "json"] as const);
      parseOpenOptions(flags);
      outputOf(flags);
      singleTarget(positionals.slice(1), flags, "list");
      return;
    case "tree":
    case "outline":
    case "tabs":
      parseFormat(flags.format, ["pretty", "json"] as const);
      parseOpenOptions(flags);
      outputOf(flags);
      singleTarget(positionals, flags, command);
      return;
    case "interact":
    case "click":
    case "type":
    case "focus":
      validateInteract(command, positionals, flags);
      return;
    default:
      return;
  }
}

/** Resolve the page target(s) a daemon command needs to build session flags. */
export function resolveCommandTargets(
  command: string,
  positionals: string[],
  flags: FlagValues,
): Target[] {
  switch (command) {
    case "interact":
    case "click":
    case "type":
    case "focus":
    case "tree":
    case "outline":
    case "tabs":
    case "inspect":
      return [singleTarget(positionals, flags, command)];
    case "list":
      return [singleTarget(positionals.slice(1), flags, "list")];
    case "audit":
      return resolveAuditTargets(positionals, flags);
    case "snapshot":
      return resolveSnapshotTargets(positionals, flags).targets;
    default:
      return [];
  }
}

export async function runCommandOnSession(
  session: BrowserSession,
  command: string,
  positionals: string[],
  flags: FlagValues,
): Promise<number> {
  switch (command) {
    case "interact":
      return runInteractOnSession(session, positionals, flags);
    case "click":
      return runClickOnSession(session, positionals, flags);
    case "type":
      return runTypeOnSession(session, positionals, flags);
    case "focus":
      return runFocusOnSession(session, positionals, flags);
    case "tree":
      return runTreeOnSession(session, positionals, flags);
    case "outline":
      return runOutlineOnSession(session, positionals, flags);
    case "tabs":
      return runTabsOnSession(session, positionals, flags);
    case "list":
      return runListOnSession(session, positionals, flags);
    case "inspect":
      return runInspectOnSession(session, positionals, flags);
    case "audit":
      return runAuditOnSession(session, positionals, flags);
    case "snapshot":
      return runSnapshotOnSession(session, positionals, flags);
    default:
      throw new Error(
        `command "${command}" is not supported by the daemon in this release`,
      );
  }
}
