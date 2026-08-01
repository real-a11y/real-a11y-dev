/**
 * Dispatcher: command table lookup → parseArgs → lazy import → error mapping.
 * `--help`/`--version` resolve before command lookup (exit 0); the per-command
 * lazy import guarantees `--help`, `--version`, and future browser-free
 * commands never load mcp or playwright code.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { SnapshotFormatError } from "@real-a11y-dev/snapshot";

import {
  COMMANDS,
  isNativeCommand,
  rootHelp,
  type FlagValues,
} from "./args.js";
import {
  configSource,
  describeConfigSource,
  mergeDefaults,
  resolveConfig,
} from "./config.js";
import { ensureDaemonClient, defaultSessionName } from "./daemon/spawn.js";
import { CliError, EXIT, formatCliError } from "./exit.js";

/**
 * `--root` used to be on nearly every command; now it is on `tabs` alone.
 *
 * The strict parser would answer a leftover `--root` with "Unknown option",
 * which reads like a typo rather than a deliberate removal — so name the reason
 * and point at what still scopes. Pre-parse, so it beats parseArgs to the punch.
 */
function assertRootApplies(name: string, flagTokens: readonly string[]): void {
  if (!isNativeCommand(name)) return;
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

const DAEMON_ENTRY = fileURLToPath(new URL("daemon/entry.js", import.meta.url));

async function runWithDaemon(
  command: string,
  positionals: string[],
  flags: FlagValues,
): Promise<number> {
  // `runner.ts` eagerly loads the command modules, so only import it when we
  // already know we're going through the daemon.
  const { validateCommand } = await import("./daemon/runner.js");
  validateCommand(command, positionals, flags);

  const sessionName =
    typeof flags.session === "string" && flags.session !== ""
      ? flags.session
      : defaultSessionName();
  const client = await ensureDaemonClient(sessionName, DAEMON_ENTRY);
  const { exitCode, stdout, stderr } = await client.run(
    sessionName,
    command,
    positionals,
    flags,
    process.cwd(),
  );
  if (stderr) process.stderr.write(stderr);
  if (stdout) process.stdout.write(stdout);
  return exitCode;
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
    // Say where the config came from before anything depends on it. Printed
    // here rather than inside `resolveConfig` because that runs twice per
    // command (defaults merge, then the page list) and the memo only covers the
    // found case — so emitting it there would double the line for exactly the
    // run where it says "none found".
    //
    // A direct write, not `progress()`, so `-q` does not silence it. That is
    // the existing split, not a new one: `-q` suppresses PROGRESS (the per-page
    // `auditing …` and its timing), while a `--verbose` diagnostic describing
    // what the run is using survives it — same as the resolved Chrome binary
    // (`session.ts`) and the browser cache directory (`chrome-install.ts`).
    // `-q --verbose` is a deliberate pair: drop the narration, keep the facts.
    if (verbose) {
      process.stderr.write(`${describeConfigSource(configSource(values))}\n`);
    }
    const resolved = resolveConfig(values);
    // Pin the config file path to the caller's cwd so the daemon (which may be
    // running from a different directory) auto-discovers the same config.
    if (resolved && values["no-config"] !== true) {
      values.config = resolved.path;
    }
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
      //
      // Only the commands that read the native tree, because the warning makes
      // a claim about WHY the key is inert. `diff`, `install`, and `login`
      // auto-discover the config too (they take --config), but they never open
      // a page — telling them they "read Chromium's accessibility tree" would
      // be plainly false, and noise in every CI log that runs `diff`.
      if (
        resolved.config.defaults.root !== undefined &&
        isNativeCommand(name)
      ) {
        process.stderr.write(
          `real-a11y: warning: \`defaults.root\` in a11y.config.json doesn't apply to \`${name}\` — ` +
            `it reads Chromium's whole-document accessibility tree. Only \`tabs\` still scopes.\n`,
        );
      }
    }
    if (values.session !== undefined) {
      const { resolveCommandTargets } = await import("./daemon/runner.js");
      let daemonTargets: { length: number } | undefined;
      let daemonErr: unknown;
      try {
        daemonTargets = resolveCommandTargets(
          name,
          positionals,
          values as FlagValues,
        );
      } catch (err) {
        daemonErr = err;
      }
      const sessionExplicit = !seededFromConfig.has("session");
      const daemonSupported =
        daemonTargets !== undefined && daemonTargets.length > 0;
      if (daemonSupported || sessionExplicit) {
        if (daemonErr) throw daemonErr;
        return await runWithDaemon(name, positionals, values as FlagValues);
      }
      // `defaults.session` in config does not force unsupported commands through
      // the daemon; fall through to the one-shot path.
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
