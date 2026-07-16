/**
 * Dispatcher: command table lookup → parseArgs → lazy import → error mapping.
 * `--help`/`--version` resolve before command lookup (exit 0); the per-command
 * lazy import guarantees `--help`, `--version`, and future browser-free
 * commands never load mcp or playwright code.
 */

import { createRequire } from "node:module";
import { parseArgs } from "node:util";

import { COMMANDS, rootHelp, type FlagValues } from "./args.js";
import { mergeDefaults, resolveConfig } from "./config.js";
import { CliError, EXIT, formatCliError } from "./exit.js";

function readVersion(spec: string): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require(spec) as { version?: string };
    return pkg.version;
  } catch {
    return undefined;
  }
}

function versionLine(): string {
  const cli = readVersion("../package.json") ?? "unknown";
  const playwright = readVersion("playwright/package.json");
  return `real-a11y ${cli} (playwright ${playwright ?? "not installed"})\n`;
}

function isParseArgsError(err: unknown): err is Error {
  return (
    err instanceof Error &&
    typeof (err as NodeJS.ErrnoException).code === "string" &&
    (err as NodeJS.ErrnoException).code!.startsWith("ERR_PARSE_ARGS")
  );
}

export async function run(argv: string[]): Promise<number> {
  if (argv.length === 0) {
    process.stderr.write(rootHelp());
    return EXIT.ERROR;
  }
  if (argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    process.stdout.write(rootHelp());
    return EXIT.OK;
  }
  if (argv[0] === "--version" || argv[0] === "-V") {
    process.stdout.write(versionLine());
    return EXIT.OK;
  }

  const name = argv[0];
  const command = COMMANDS[name];
  if (!command) {
    process.stderr.write(
      `real-a11y: error: unknown command "${name}"\n\n${rootHelp()}`,
    );
    return EXIT.ERROR;
  }

  const rest = argv.slice(1);
  // Raw pre-scan (stopping at "--") catches --help even when the rest of the
  // line wouldn't parse; the post-parse check catches grouped shorts (-qh).
  const doubleDash = rest.indexOf("--");
  const flagTokens = doubleDash === -1 ? rest : rest.slice(0, doubleDash);
  if (flagTokens.includes("--help") || flagTokens.includes("-h")) {
    process.stdout.write(command.help);
    return EXIT.OK;
  }

  const verbose = flagTokens.includes("--verbose");
  try {
    const { values, positionals } = parseArgs({
      args: rest,
      options: command.options,
      allowPositionals: true,
      strict: true,
    });
    if ((values as FlagValues).help === true) {
      process.stdout.write(command.help);
      return EXIT.OK;
    }
    // Seed unset flags from a11y.config.json's `defaults` (browser-free; runs
    // only after the --help/--version short-circuits above). An explicit flag
    // already parsed into `values` wins; the config value fills the gap and is
    // validated by the command's own parser downstream. Scoped to this
    // command's declared flags so a default can't reach a flag it would reject.
    const resolved = resolveConfig(values);
    if (resolved) {
      mergeDefaults(
        values,
        resolved.config,
        new Set(Object.keys(command.options)),
      );
    }
    const fn = await command.load();
    return await fn(positionals, values as FlagValues);
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`${formatCliError(err)}\n`);
      return EXIT.ERROR;
    }
    if (isParseArgsError(err)) {
      process.stderr.write(
        `real-a11y: error: ${err.message}\n  hint: run 'real-a11y ${name} --help' for usage\n`,
      );
      return EXIT.ERROR;
    }
    const detail =
      err instanceof Error
        ? verbose
          ? (err.stack ?? err.message)
          : err.message
        : String(err);
    process.stderr.write(
      `real-a11y: error: unexpected failure — ${detail}\n` +
        (verbose ? "" : "  hint: re-run with --verbose for the stack trace\n"),
    );
    return EXIT.ERROR;
  }
}
