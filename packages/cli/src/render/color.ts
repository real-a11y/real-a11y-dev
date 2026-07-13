/**
 * Hand-rolled ANSI (5 codes — not worth a dependency). Color is presentation
 * only: severity is always carried by the `[error]`/`[warning]` text tags and
 * diff direction by the `+`/`-` markers, so nothing is conveyed by color alone.
 *
 * Enablement: FORCE_COLOR wins, NO_COLOR disables, otherwise TTY — plus
 * GITHUB_ACTIONS, whose logs render ANSI even though stdout is a pipe (the
 * flagship CI environment would otherwise be permanently colorless).
 */

export function colorEnabled(
  stream: { isTTY?: boolean } = process.stdout,
): boolean {
  const env = process.env;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") return true;
  if (env.NO_COLOR) return false;
  return stream.isTTY === true || env.GITHUB_ACTIONS === "true";
}

export interface Palette {
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  bold(s: string): string;
  dim(s: string): string;
}

const wrap =
  (open: string, close: string) =>
  (s: string): string =>
    `${open}${s}${close}`;
const identity = (s: string): string => s;

export function palette(enabled: boolean): Palette {
  if (!enabled) {
    return {
      red: identity,
      green: identity,
      yellow: identity,
      bold: identity,
      dim: identity,
    };
  }
  return {
    red: wrap("[31m", "[39m"),
    green: wrap("[32m", "[39m"),
    yellow: wrap("[33m", "[39m"),
    bold: wrap("[1m", "[22m"),
    dim: wrap("[2m", "[22m"),
  };
}
