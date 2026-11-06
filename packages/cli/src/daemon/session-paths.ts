/**
 * Session naming and the filesystem / named-pipe locations of a daemon's
 * socket, pidfile, log and token. Split out of `spawn.ts`, which re-exports
 * the public names.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform, userInfo } from "node:os";
import { basename, join } from "node:path";

export interface SessionPaths {
  socketPath: string;
  pidfile: string;
  logFile: string;
  tokenFile: string;
  /** Windows only: holds the random id the named pipe's name is built from. */
  pipeFile: string;
  sessionDir: string;
}

export function isWindows(): boolean {
  return platform() === "win32";
}

export function sanitizeSessionName(name: string): string {
  // Replace path separators / shell metacharacters, then append a short hash of
  // the original so distinct names such as "team/prod" and "team_prod" don't
  // collide when sanitized.
  const base = name.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 55);
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 8);
  return `${base}_${hash}`;
}

export function currentUser(): string {
  // `userInfo()` can throw in minimal containers; fall back to env vars.
  try {
    return sanitizeSessionName(userInfo().username);
  } catch {
    return sanitizeSessionName(
      process.env.USERNAME ?? process.env.USER ?? "user",
    );
  }
}

export function isNamedPipe(socketPath: string): boolean {
  return socketPath.startsWith("\\\\.\\pipe\\");
}

export function windowsPipePath(pipeId: string): string {
  // The pipe name is discoverable by any local process that can enumerate
  // `\\.\pipe\`, so it must be independent of the auth token — a hash of the
  // secret in a public name would hand a local attacker an offline oracle for
  // verifying guessed tokens. The id is random, generated at spawn time, and
  // stored in the session directory's `pipe` file so later invocations can
  // find the pipe; the token is still required for every RPC `auth` message.
  return `\\\\.\\pipe\\real-a11y-${pipeId}`;
}

export function resolveWindowsSocketPath(
  basePath: string,
  pipeId: string | undefined,
): string {
  return pipeId ? windowsPipePath(pipeId) : basePath;
}

export async function readPipeId(
  paths: SessionPaths,
): Promise<string | undefined> {
  try {
    const id = (await readFile(paths.pipeFile, "utf8")).trim();
    return id || undefined;
  } catch {
    return undefined;
  }
}

export function sessionPaths(name: string): SessionPaths {
  const safe = sanitizeSessionName(name);
  const dir = join(homedir(), ".real-a11y", "sessions", safe);
  const socketPath = isWindows()
    ? `\\\\.\\pipe\\real-a11y-${currentUser()}-${safe}`
    : join(dir, "daemon.sock");
  return {
    socketPath,
    pidfile: join(dir, "daemon.pid"),
    logFile: join(dir, "daemon.log"),
    tokenFile: join(dir, "token"),
    pipeFile: join(dir, "pipe"),
    sessionDir: dir,
  };
}

export function pathsForSessionDir(dir: string): SessionPaths {
  return {
    socketPath: isWindows()
      ? `\\\\.\\pipe\\real-a11y-${currentUser()}-${basename(dir)}`
      : join(dir, "daemon.sock"),
    pidfile: join(dir, "daemon.pid"),
    logFile: join(dir, "daemon.log"),
    tokenFile: join(dir, "token"),
    pipeFile: join(dir, "pipe"),
    sessionDir: dir,
  };
}

export function defaultSessionName(): string {
  return createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16);
}

export async function writeSessionName(
  sessionDir: string,
  name: string,
): Promise<void> {
  await mkdir(sessionDir, { recursive: true, mode: 0o700 });
  await writeFile(join(sessionDir, "name.txt"), name, { mode: 0o600 });
}

export async function readSessionName(
  sessionDir: string,
): Promise<string | undefined> {
  try {
    return (await readFile(join(sessionDir, "name.txt"), "utf8")).trim();
  } catch {
    return undefined;
  }
}
