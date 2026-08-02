import type { Finding } from "@real-a11y-dev/audit";

/**
 * The frozen exit-code contract: 0 clean, 1 findings at/above `--fail-on`,
 * 2 usage/navigation/engine error. Precedence 2 > 1 > 0.
 */
export const EXIT = {
  OK: 0,
  FINDINGS: 1,
  ERROR: 2,
} as const;

/** Severity threshold for turning findings into a non-zero exit. */
export type FailOn = "error" | "warning" | "never";

/**
 * An expected, user-facing failure: rendered as `real-a11y: error: <message>`
 * plus an optional remedy hint, and mapped to exit code 2 — never a stack
 * trace (those are for `--verbose` + unexpected errors only).
 */
export class CliError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
    readonly exitCode?: number,
  ) {
    super(message);
    this.name = "CliError";
  }
}

/**
 * A transient failure because the session daemon is shutting down. The client
 * should treat this like a lost connection and retry against a fresh daemon.
 */
export class DaemonShutdownError extends Error {
  constructor() {
    super("session daemon is shutting down");
    this.name = "DaemonShutdownError";
  }
}

export function formatCliError(err: {
  message: string;
  hint?: string;
}): string {
  const hint = err.hint ? `\n  hint: ${err.hint}` : "";
  return `real-a11y: error: ${err.message}${hint}`;
}

/** True when `findings` contain anything at/above the `failOn` threshold. */
export function exceedsThreshold(
  findings: readonly Finding[],
  failOn: FailOn,
): boolean {
  if (failOn === "never") return false;
  if (failOn === "warning") return findings.length > 0;
  return findings.some((f) => f.severity === "error");
}
