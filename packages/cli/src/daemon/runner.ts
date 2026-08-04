/**
 * Daemon-side command dispatch against a live session.
 *
 * PR A wires the `interact` / `click` / `type` / `focus` verbs and the four
 * view commands (`tree`, `outline`, `tabs`, `list`).  `audit` and `snapshot`
 * follow in PR B once they are split into one-shot wrappers and session-aware
 * cores.
 */

import type { BrowserSession } from "@real-a11y-dev/browser";

import type { FlagValues } from "../args.js";
import { singleTarget, type Target } from "../commands/common.js";
import {
  runClickOnSession,
  runFocusOnSession,
  runInteractOnSession,
  runTypeOnSession,
} from "../commands/interact.js";
import {
  runListOnSession,
  runOutlineOnSession,
  runTabsOnSession,
  runTreeOnSession,
} from "../commands/views.js";

/** Resolve the page target a daemon command will run against for session flags. */
export function resolveCommandTarget(
  command: string,
  positionals: string[],
  flags: FlagValues,
): Target | undefined {
  switch (command) {
    case "interact":
    case "click":
    case "type":
    case "focus":
    case "tree":
    case "outline":
    case "tabs":
      return singleTarget(positionals, flags, command);
    case "list":
      return singleTarget(positionals.slice(1), flags, "list");
    default:
      return undefined;
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
    default:
      throw new Error(
        `command "${command}" is not supported by the daemon in this release`,
      );
  }
}
