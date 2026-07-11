/** Shared target/flag plumbing for the browser-driving commands. */

import type { FlagValues } from "../args.js";
import { CliError } from "../exit.js";
import { redactUrl } from "../sanitize.js";
import type { SessionFlags } from "../session.js";
import { assertAllowedUrl, normalizeTarget } from "../url-gate.js";

export interface Target {
  /** Normalized absolute URL (paths become file: URLs). */
  url: string;
  /** Display identity: the redacted URL. Also the fingerprint page component. */
  name: string;
  /** True when this is a file: target the gate approved. */
  fileApproved: boolean;
}

/**
 * Normalize + admit every positional target, fail-fast before any browser
 * launches. Approving a file: target unlocks the engine's internal env gate
 * for this process (index.ts wiped any inherited value at startup).
 */
export function resolveTargets(
  positionals: readonly string[],
  flags: FlagValues,
): Target[] {
  if (positionals.length === 0) {
    throw new CliError(
      "no URL given",
      "usage: real-a11y <command> <url> — see --help",
    );
  }
  const targets = positionals.map((input) => {
    const url = normalizeTarget(input);
    const fileApproved = assertAllowedUrl(url, {
      source: "arg",
      allowFile: flags["allow-file"] === true,
    });
    return { url, name: redactUrl(url), fileApproved };
  });
  if (targets.some((t) => t.fileApproved)) {
    process.env.REAL_A11Y_MCP_ALLOW_FILE = "1";
  }
  return targets;
}

export function singleTarget(
  positionals: readonly string[],
  flags: FlagValues,
  command: string,
): Target {
  if (positionals.length !== 1) {
    throw new CliError(
      `${command} takes exactly one URL (got ${positionals.length})`,
      `usage: real-a11y ${command} <url>`,
    );
  }
  return resolveTargets(positionals, flags)[0];
}

export function sessionFlags(flags: FlagValues): SessionFlags {
  return {
    headful: flags.headful === true,
    ...(typeof flags.cdp === "string" ? { cdp: flags.cdp } : {}),
  };
}

export function rootOf(flags: FlagValues): string {
  return typeof flags.root === "string" ? flags.root : "body";
}

export function outputOf(flags: FlagValues): string | undefined {
  return typeof flags.output === "string" ? flags.output : undefined;
}
