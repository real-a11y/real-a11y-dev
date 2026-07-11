/**
 * Hand-rolled ANSI (4 codes — not worth a dependency). Color is presentation
 * only: severity is always carried by the `[error]`/`[warning]` text tags, so
 * nothing is conveyed by color alone.
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
    return { red: identity, yellow: identity, bold: identity, dim: identity };
  }
  return {
    red: wrap("\u001B[31m", "\u001B[39m"),
    yellow: wrap("\u001B[33m", "\u001B[39m"),
    bold: wrap("\u001B[1m", "\u001B[22m"),
    dim: wrap("\u001B[2m", "\u001B[22m"),
  };
}
