// The CLI's public surface, from the table `parseArgs` actually dispatches on.

import { join } from "node:path";

import { loadTs } from "../ts-load.mjs";

/**
 * Flags, normalized out of a command's `parseArgs` options.
 *
 * `short` and `multiple` are recorded because both are part of what a user can
 * type — `-f` and a repeatable `--step` are surface, not implementation.
 */
function flagsOf(options) {
  return Object.entries(options)
    .map(([name, spec]) => ({
      name,
      type: spec.type,
      ...(spec.short ? { short: spec.short } : {}),
      ...(spec.multiple ? { multiple: true } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The invocation line, from the command's own `--help`.
 *
 * Help text is hand-written but it is also what ships: if the usage line is
 * wrong, the user is misled by the binary itself, not just by the docs. Taking
 * it from there rather than from a second annotation keeps it that way.
 */
function usageOf(help) {
  const line = /^Usage: real-a11y (.+)$/m.exec(help);
  return line ? line[1].trim() : null;
}

export async function extractCli(repoRoot) {
  const pkgDir = join(repoRoot, "packages", "cli");
  const { args, exit } = await loadTs(pkgDir, {
    args: "src/args.ts",
    exit: "src/exit.ts",
  });

  const commands = Object.entries(args.COMMANDS).map(([name, spec]) => ({
    name,
    summary: spec.summary,
    group: spec.group,
    producers: [...spec.producers],
    usage: usageOf(spec.help),
    flags: flagsOf(spec.options),
  }));

  return {
    bin: "real-a11y",
    // Frozen contract — the docs state it as a table and CI gates on it.
    exitCodes: Object.entries(exit.EXIT)
      .map(([name, code]) => ({ name, code }))
      .sort((a, b) => a.code - b.code),
    commands: commands.sort((a, b) => a.name.localeCompare(b.name)),
    listCategories: [...args.LIST_CATEGORIES],
    // Which commands read Chromium's own accessibility tree, as the CLI itself
    // computes it. No longer a `--producer` opt-in — the flag is gone, each
    // command has exactly one producer — but still the fact that decides
    // whether `--root` applies, so it stays derived rather than restated.
    nativeCommands: args.nativeCommands(),
  };
}
