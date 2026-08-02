/**
 * `real-a11y session` lifecycle commands.
 *
 * List, stop, and stop-all long-lived daemon sessions. These commands never
 * launch a browser themselves; they manage the per-session daemons that
 * browser-driving invocations with `--session` reuse.
 */

import { type FlagValues, parseFormat } from "../args.js";
import {
  listSessions,
  resolveSessionPaths,
  stopAllSessions,
  stopSession,
  type SessionStatus,
} from "../daemon/spawn.js";

import { CliError, EXIT } from "../exit.js";
import { progress, writeReport } from "../output.js";
import { JSON_SCHEMA_VERSION } from "../render/json.js";

import { outputOf } from "./common.js";

/**
 * `--format`/`--output`/`--strict` are declared once for the whole `session`
 * command (parseArgs options are per-command, not per-subcommand), but each is
 * honoured by exactly one subcommand. Reject an inapplicable flag by name —
 * the `--text applies to \`type\`` precedent — instead of silently accepting
 * `session stop x --format json` and printing nothing.
 *
 * Config seeding cannot trip this: `output`/`strict` are not defaultable keys,
 * and the `session` command excludes `format` from config defaults.
 */
function rejectInapplicableFlags(
  subcommand: "list" | "stop" | "stop-all",
  flags: FlagValues,
): void {
  const appliesTo = {
    format: "list",
    output: "list",
    strict: "stop-all",
  } as const;
  for (const [flag, target] of Object.entries(appliesTo)) {
    if (subcommand === target) continue;
    if (flags[flag] !== undefined) {
      throw new CliError(
        `--${flag} applies to \`session ${target}\`, not \`session ${subcommand}\``,
      );
    }
  }
}

export async function sessionCommand(
  positionals: readonly string[],
  flags: FlagValues,
): Promise<number> {
  const subcommand = positionals[0];

  switch (subcommand) {
    case "list":
      rejectInapplicableFlags(subcommand, flags);
      return listSubcommand(positionals.slice(1), flags);
    case "stop":
      rejectInapplicableFlags(subcommand, flags);
      return stopSubcommand(positionals.slice(1), flags);
    case "stop-all":
      rejectInapplicableFlags(subcommand, flags);
      return stopAllSubcommand(positionals.slice(1), flags);
    case undefined:
    case "":
      throw new CliError(
        "no session subcommand given",
        "usage: real-a11y session <list|stop|stop-all>",
      );
    default:
      throw new CliError(
        `unknown session subcommand "${subcommand}"`,
        "usage: real-a11y session <list|stop|stop-all>",
      );
  }
}

async function listSubcommand(
  positionals: readonly string[],
  flags: FlagValues,
): Promise<number> {
  if (positionals.length > 0) {
    throw new CliError(
      "session list takes no arguments",
      "usage: real-a11y session list",
    );
  }

  // Validate flags and output path before contacting any background daemon.
  const format = parseFormat(flags.format as string | undefined, [
    "pretty",
    "json",
  ]);
  outputOf(flags);

  const sessions = await listSessions();

  if (format === "json") {
    writeReport(
      typeof flags.output === "string" ? flags.output : undefined,
      JSON.stringify(
        {
          schemaVersion: JSON_SCHEMA_VERSION,
          command: "session list",
          sessions,
        },
        null,
        2,
      ) + "\n",
    );
    return EXIT.OK;
  }

  const out = renderSessionTable(sessions);
  writeReport(typeof flags.output === "string" ? flags.output : undefined, out);
  return EXIT.OK;
}

async function stopSubcommand(
  positionals: readonly string[],
  flags: FlagValues,
): Promise<number> {
  const name = positionals[0];
  if (!name) {
    throw new CliError(
      "session stop requires a session name",
      "usage: real-a11y session stop <name>",
    );
  }
  if (positionals.length > 1) {
    throw new CliError(
      "session stop takes exactly one session name",
      "usage: real-a11y session stop <name>",
    );
  }

  const status = await stopSession(name);
  switch (status) {
    case "stopped":
      progress(`stopped session "${name}"`, { quiet: flags.quiet === true });
      return EXIT.OK;
    case "not-running":
      progress(`session "${name}" not running`, {
        quiet: flags.quiet === true,
      });
      return EXIT.OK;
    case "locked":
      throw new CliError(
        `could not stop session "${name}" — another process may be starting it`,
        "retry once the other invocation finishes, or remove the session's .lock file if it is stale",
      );
    case "failed": {
      const resolved = await resolveSessionPaths(name);
      throw new CliError(
        `daemon process for session "${name}" did not exit; session files kept`,
        `if the daemon is truly gone, remove ${resolved.sessionDir} and retry`,
      );
    }
  }
}

async function stopAllSubcommand(
  positionals: readonly string[],
  flags: FlagValues,
): Promise<number> {
  if (positionals.length > 0) {
    throw new CliError(
      "session stop-all takes no arguments",
      "usage: real-a11y session stop-all",
    );
  }

  const { stopped, locked, notRunning, failed } = await stopAllSessions();
  const parts = [`stopped ${stopped} session(s)`];
  if (locked > 0) parts.push(`${locked} could not be stopped (locked)`);
  if (failed > 0) parts.push(`${failed} failed to stop`);
  if (notRunning > 0) parts.push(`${notRunning} not running`);
  const message = parts.join("; ");
  if (failed > 0) {
    throw new CliError(message);
  }
  if (locked > 0) {
    if (flags.strict === true) {
      throw new CliError(message, undefined, EXIT.ERROR);
    }
    progress(`warning: ${message}`, { quiet: flags.quiet === true });
    return EXIT.OK;
  }
  progress(message, { quiet: flags.quiet === true });
  return EXIT.OK;
}

function renderSessionTable(sessions: SessionStatus[]): string {
  if (sessions.length === 0) {
    return "no sessions\n";
  }

  const headers: (keyof SessionStatus)[] = [
    "name",
    "pid",
    "status",
    "url",
    "busy",
  ];
  const widths = headers.map((h) =>
    Math.max(
      String(h).length,
      ...sessions.map((s) => String(s[h] ?? "").length),
    ),
  );

  const rows = sessions.map((s) =>
    headers.map((h, i) => String(s[h] ?? "").padEnd(widths[i])).join("  "),
  );

  const header = headers.map((h, i) => String(h).padEnd(widths[i])).join("  ");

  return [header, "-".repeat(header.length), ...rows, ""].join("\n");
}
