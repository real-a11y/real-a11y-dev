/**
 * `real-a11y install` — download Chrome for Testing into Real A11y's own
 * cache (first time only) and record it for every launched session to use.
 * Deliberately never imports playwright or `../session.js`: installing a
 * browser must work even before playwright is installed.
 */

import { parseChannel, type CommandFn } from "../args.js";
import { runInstall } from "../chrome-install.js";
import { CliError } from "../exit.js";

export const installCommand: CommandFn = async (positionals, flags) => {
  if (positionals.length > 0) {
    throw new CliError(
      `install takes no arguments (got ${positionals.join(", ")})`,
      "usage: real-a11y install [--channel <name> | --version <buildId>] [--force]",
    );
  }
  const channel = parseChannel(flags.channel);
  const version = typeof flags.version === "string" ? flags.version : undefined;
  if (flags.version !== undefined && version === undefined) {
    throw new CliError(
      "--version expects a value, e.g. --version 131.0.6778.87",
    );
  }

  return runInstall({
    channel,
    version,
    force: flags.force === true,
    quiet: flags.quiet === true,
    verbose: flags.verbose === true,
  });
};
