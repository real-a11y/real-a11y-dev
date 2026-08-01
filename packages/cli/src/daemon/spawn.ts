/**
 * Locate the daemon socket / pidfile for a session name and start the daemon
 * when it isn't already listening.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { CliError } from "../exit.js";

import { DaemonClient } from "./client.js";

export interface SessionPaths {
  socketPath: string;
  pidfile: string;
  logFile: string;
}

function sanitizeSessionName(name: string): string {
  // Replace path separators / shell metacharacters, then append a short hash of
  // the original so distinct names such as "team/prod" and "team_prod" don't
  // collide when sanitized.
  const base = name.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 55);
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 8);
  return `${base}_${hash}`;
}

export function sessionPaths(name: string): SessionPaths {
  const safe = sanitizeSessionName(name);
  const dir = join(homedir(), ".real-a11y", "sessions", safe);
  return {
    socketPath: join(dir, "daemon.sock"),
    pidfile: join(dir, "daemon.pid"),
    logFile: join(dir, "daemon.log"),
  };
}

export function defaultSessionName(): string {
  return createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16);
}

function waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = (): void => {
      const socket = createConnection(socketPath);
      socket.on("connect", () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        if (Date.now() > deadline) {
          reject(
            new CliError(`daemon socket did not appear within ${timeoutMs}ms`),
          );
        } else {
          setTimeout(attempt, 50);
        }
      });
    };
    attempt();
  });
}

/**
 * Return a client connected to the daemon for `name`, spawning it if necessary.
 */
export async function ensureDaemonClient(
  name: string,
  daemonPath: string,
  idleTimeoutMs = 900_000,
): Promise<DaemonClient> {
  const paths = sessionPaths(name);
  await mkdir(dirname(paths.socketPath), { recursive: true, mode: 0o700 });

  const client = new DaemonClient({ socketPath: paths.socketPath });
  try {
    // Fast path: a daemon is already listening.
    await client.version();
    return client;
  } catch {
    // A stale socket file from a crashed daemon can block the new daemon from
    // listening; remove it before spawning. The daemon entry also removes it, but
    // doing it here covers races where the entry hasn't started yet.
    await rm(paths.socketPath, { force: true });

    // Spawn a detached daemon and wait for its socket.
    const child = spawn(
      process.execPath,
      [
        daemonPath,
        "--socket",
        paths.socketPath,
        "--pidfile",
        paths.pidfile,
        "--idle-timeout-ms",
        String(idleTimeoutMs),
        "--log-file",
        paths.logFile,
      ],
      { detached: true, stdio: "ignore" },
    );

    await new Promise<void>((resolve, reject) => {
      child.on("error", (err) => {
        reject(new CliError(`failed to spawn daemon: ${err.message}`));
      });
      child.on("spawn", () => {
        // Unref so the CLI can exit while the daemon keeps running.
        child.unref();
        resolve();
      });
    });

    await waitForSocket(paths.socketPath, 15_000);
    return client;
  }
}
