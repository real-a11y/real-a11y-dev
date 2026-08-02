#!/usr/bin/env node
/**
 * Session daemon entrypoint.
 *
 * Spawned by the CLI client on first `--session` use.  It owns the socket,
 * writes its pidfile, and keeps sessions warm until the idle timeout fires or
 * a `stop-all` request arrives.
 */

import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

import { redactUrlsIn } from "@real-a11y-dev/snapshot";

import { DaemonServer } from "./server.js";
import { tightenWindowsTokenAcl } from "./windows-acl.js";

// Capture the original stderr write at module load so daemon-internal logging
// is not redirected into a command's captured stdout/stderr stream.
const originalStderrWrite = process.stderr.write.bind(process.stderr);

const URL_IN_LOG_RE = /\b(?:https?|file|ftp|sftp|wss?):\/\/\S+/g;
const WIN_PATH_RE = /\b[a-zA-Z]:\\(?:[^\s"'<>|]+|\\\\)*/g;
// Match POSIX absolute paths that may appear in Playwright errors or other
// messages. Avoid matching lone `/` or path fragments inside words.
const POSIX_PATH_RE = /(^|[^A-Za-z0-9_/])(\/[^\s"'<>|]+(?:\/[^\s"'<>|]+)*)/g;

function redactLogMessage(message: string): string {
  // Strip credentials/secret query params, then replace the whole URL so
  // origins and paths do not persist in the long-lived daemon log. This covers
  // http(s), file://, and other URL schemes, plus Windows drive paths and
  // POSIX absolute paths that may appear in Playwright error messages.
  return redactUrlsIn(message)
    .replace(URL_IN_LOG_RE, "[URL]")
    .replace(WIN_PATH_RE, "[PATH]")
    .replace(POSIX_PATH_RE, "$1[PATH]");
}

function log(message: string, logFile?: string): void {
  const safeMessage = redactLogMessage(message);
  const line = `[${new Date().toISOString()}] ${safeMessage}\n`;
  if (logFile) {
    try {
      // Create/append owner-only, then tighten permissions in case the file was
      // pre-created with looser ones (backups, restores, older builds).
      appendFileSync(logFile, line, { flag: "a", mode: 0o600 });
      try {
        chmodSync(logFile, 0o600);
      } catch {
        // best effort
      }
    } catch {
      // If logging fails, still try stderr.
    }
  }
  // Write through the original stderr so this line is never captured as part of
  // a command's stdout/stderr stream (see `installCapture` in server.ts).
  originalStderrWrite(line);
}

function isNamedPipe(socketPath: string): boolean {
  return socketPath.startsWith("\\\\.\\pipe\\");
}

function prepareSocket(socketPath: string): void {
  if (isNamedPipe(socketPath)) {
    // Windows named pipes are not filesystem paths; the server creates and
    // removes them automatically when it closes.
    return;
  }
  const dir = dirname(socketPath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    rmSync(socketPath, { force: true });
  } catch {
    // ignore
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      socket: { type: "string" },
      pidfile: { type: "string" },
      "idle-timeout-ms": { type: "string" },
      "log-file": { type: "string" },
      "daemon-version": { type: "string" },
      "token-file": { type: "string" },
    },
    allowPositionals: false,
  });

  const socketPath = values.socket;
  if (!socketPath) {
    originalStderrWrite("daemon: --socket is required\n");
    process.exit(2);
  }

  const rawIdle = Number(values["idle-timeout-ms"] ?? 900_000);
  if (!Number.isFinite(rawIdle) || rawIdle <= 0) {
    originalStderrWrite(
      "daemon: --idle-timeout-ms must be a positive number of milliseconds\n",
    );
    process.exit(2);
  }
  // Clamp positive values to a sensible range so a typo can't keep the daemon
  // alive forever or exit instantly. `0` is not accepted because the CLI docs
  // describe the timeout as capped at one hour.
  const idleTimeoutMs = Math.min(Math.max(rawIdle, 1_000), 3_600_000);

  const tokenFile = values["token-file"];
  if (typeof tokenFile !== "string" || tokenFile === "") {
    originalStderrWrite("daemon: --token-file is required\n");
    process.exit(2);
  }
  let authToken: string;
  try {
    // The daemon is started by the CLI, but the token file it reads must still
    // be owner-only and owned by this user. A restored backup or loose archive
    // should not silently widen the auth surface.
    if (process.platform === "win32") {
      // On Windows `chmod` is a no-op, so re-apply/tighten the token-file ACL
      // before reading. If this fails, fail closed rather than accept a token
      // that may be readable by other local users.
      await tightenWindowsTokenAcl(tokenFile);
    } else {
      const st = statSync(tokenFile);
      if (typeof process.getuid === "function" && st.uid !== process.getuid()) {
        throw new Error("token file is owned by a different user");
      }
      if ((st.mode & 0o077) !== 0) {
        throw new Error("token file is readable by group or other users");
      }
    }
    authToken = readFileSync(tokenFile, "utf8").trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    originalStderrWrite(`daemon: could not read --token-file: ${message}\n`);
    process.exit(2);
  }
  if (!authToken) {
    originalStderrWrite("daemon: --token-file is empty\n");
    process.exit(2);
  }

  // The daemon must not inherit an ambient file:// allow flag from the shell
  // that spawned it; each run carries its own approval.
  delete process.env.REAL_A11Y_MCP_ALLOW_FILE;

  prepareSocket(socketPath);

  const server = new DaemonServer({
    socketPath,
    pidfile: values.pidfile,
    daemonVersion: values["daemon-version"],
    idleTimeoutMs,
    authToken,
    onLog: (message) => log(message, values["log-file"]),
  });

  const shutdown = async (signal: string): Promise<void> => {
    log(`caught ${signal}, shutting down`, values["log-file"]);
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  server.start().catch((err: unknown) => {
    log(`failed to start: ${String(err)}`, values["log-file"]);
    process.exit(2);
  });
}

void main().catch((err: unknown) => {
  originalStderrWrite(`daemon: unexpected error: ${String(err)}\n`);
  process.exit(2);
});
