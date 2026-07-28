/**
 * Dispatcher: command table lookup → parseArgs → lazy import → error mapping.
 * `--help`/`--version` resolve before command lookup (exit 0); the per-command
 * lazy import guarantees `--help`, `--version`, and future browser-free
 * commands never load mcp or playwright code.
 */

import { createRequire } from "node:module";
import { parseArgs } from "node:util";

import { SnapshotFormatError } from "@real-a11y-dev/snapshot";

import {
  COMMANDS,
  NATIVE_COMMANDS,
  rootHelp,
  type FlagValues,
} from "./args.js";
import { mergeDefaults, resolveConfig } from "./config.js";
import { CliError, EXIT, formatCliError } from "./exit.js";

/**
 * `--root` used to be on nearly every command; now it is on `tabs` alone.
 *
 * The strict parser would answer a leftover `--root` with "Unknown option",
 * which reads like a typo rather than a deliberate removal — so name the reason
 * and point at what still scopes. Pre-parse, so it beats parseArgs to the punch.
 */
function assertRootApplies(name: string, flagTokens: readonly string[]): void {
  if (!NATIVE_COMMANDS.has(name)) return;
  if (!flagTokens.some((t) => t === "--root" || t.startsWith("--root=")))
    return;
  throw new CliError(
    `\`${name}\` reads Chromium's whole-document accessibility tree — there is nothing for --root to scope.`,
    "drop --root. 'real-a11y tabs --root <selector>' still scopes the tab-order walk, and a route's urls[].rootSelector still identifies it.",
  );
}

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
    assertRootApplies(name, flagTokens);
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
    let seededFromConfig: ReadonlySet<string> = new Set();
    if (resolved) {
      seededFromConfig = mergeDefaults(
        values,
        resolved.config,
        new Set(Object.keys(command.options)),
      );
      // `defaults.root` now reaches only `tabs`. Warn rather than hard-error:
      // the config loader is strict and fail-closed, so erroring here would red
      // every CI that set this key — mid-beta, over config that was correct
      // when it was written, for a change the user didn't make.
      if (resolved.config.defaults.root !== undefined && name !== "tabs") {
        process.stderr.write(
          `real-a11y: warning: \`defaults.root\` in a11y.config.json no longer applies to \`${name}\` — ` +
            `it reads Chromium's whole-document accessibility tree. Only \`tabs\` still scopes.\n`,
        );
      }
    }
    const fn = await command.load();
    return await fn(positionals, values as FlagValues, seededFromConfig);
  } catch (err) {
    if (err instanceof CliError || err instanceof SnapshotFormatError) {
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
