/**
 * Session inspection: list every session directory under
 * `~/.real-a11y/sessions/` and probe the daemon for live sessions.
 */

import { readFile, readdir, rmdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { DaemonClient } from "./client.js";
import { isProcessAlive, readPidfile } from "./pidfile.js";
import {
  isWindows,
  pathsForSessionDir,
  readPipeId,
  readSessionName,
  resolveWindowsSocketPath,
  type SessionPaths,
} from "./session-paths.js";
import { isDirectoryOwnedByUs, isStaleLock } from "./session-probe.js";
import { isSocketPresent } from "./socket-probe.js";

export interface SessionStatus {
  name: string;
  pid?: number;
  status: "running" | "starting" | "stale";
  url?: string;
  createdAt?: number;
  lastUsedAt?: number;
  busy?: boolean;
}

/**
 * A session directory with no readable pidfile: a daemon may be starting, or a
 * session ended/crashed. Returns the entries to report (none when the empty
 * directory was garbage-collected).
 */
async function classifyWithoutPidfile(
  dirPath: string,
  entry: string,
  paths: SessionPaths,
): Promise<SessionStatus[]> {
  const nameOf = async (): Promise<string> =>
    (await readSessionName(dirPath)) ?? entry;
  // A daemon may be starting up and has not written its pidfile yet. Use a
  // generous grace for an unreadable lock so a slow start is not mistaken
  // for a stale one in this destructive path.
  const lockPath = join(dirPath, ".lock");
  const locked = !(await isStaleLock(lockPath, {
    unreadableGraceMs: 30_000,
  }).catch(() => true));
  if (locked)
    return [{ name: await nameOf(), pid: undefined, status: "starting" }];
  // No pidfile and no live lock. If a socket file still exists, a daemon
  // is probably still starting; leave it alone. Otherwise this is a
  // clean-shutdown or crashed session. Preserve the directory (and its
  // daemon.log) so post-mortem debugging is possible; `session stop` /
  // `stop-all` remove the directory on request.
  if (await isSocketPresent(paths.socketPath)) {
    return [{ name: await nameOf(), pid: undefined, status: "starting" }];
  }
  const logExists = await stat(paths.logFile)
    .then((s) => s.isFile())
    .catch(() => false);
  if (logExists) {
    return [{ name: await nameOf(), pid: undefined, status: "stale" }];
  }
  // Only remove the directory if it is empty. A non-empty directory
  // without a pidfile/socket/log is a failed start; report it as stale so
  // `session stop` / `stop-all` can clean it up, since `rmdir` alone
  // cannot remove it.
  try {
    await rmdir(dirPath);
    return [];
  } catch {
    return [{ name: await nameOf(), pid: undefined, status: "stale" }];
  }
}

/** Ask a live daemon for its sessions. */
async function probeLiveDaemon(
  dirPath: string,
  entry: string,
  paths: SessionPaths,
  pid: number,
): Promise<SessionStatus[]> {
  const client = new DaemonClient({
    socketPath: paths.socketPath,
    tokenFile: paths.tokenFile,
  });
  try {
    const sessions = await client.list();
    if (sessions.length === 0) {
      // Daemon is alive but has no sessions yet (or just finished stop-all).
      const name = (await readSessionName(dirPath)) ?? entry;
      return [
        {
          name,
          pid,
          status: "running",
          url: undefined,
          createdAt: undefined,
          lastUsedAt: undefined,
          busy: false,
        },
      ];
    }
    return sessions.map((info) => ({
      name: info.name,
      pid,
      status: "running",
      url: info.url,
      createdAt: info.createdAt,
      lastUsedAt: info.lastUsedAt,
      busy: info.busy,
    }));
  } catch {
    const name = (await readSessionName(dirPath)) ?? entry;
    return [{ name, pid, status: "starting" }];
  }
}

async function inspectSessionDir(
  dirPath: string,
  entry: string,
): Promise<SessionStatus[]> {
  const paths = pathsForSessionDir(dirPath);
  let token: string | undefined;
  let pipeId: string | undefined;
  if (isWindows()) {
    token = await readFile(paths.tokenFile, "utf8").catch(() => undefined);
    pipeId = await readPipeId(paths);
    paths.socketPath = resolveWindowsSocketPath(paths.socketPath, pipeId);
  }
  const pidInfo = await readPidfile(paths.pidfile);
  if (!pidInfo) return classifyWithoutPidfile(dirPath, entry, paths);

  // A dead pidfile means the daemon crashed or was killed. Keep the directory
  // (and its daemon.log) so the user can diagnose it; only an explicit
  // `session stop` / `stop-all` removes it. On Windows the pipe name lives in
  // the session's `pipe` file and the token authenticates every RPC; without
  // either we cannot reach the daemon, so treat the session as stale.
  const unreachable =
    !isProcessAlive(pidInfo.pid) ||
    (isWindows() && (!token?.trim() || !pipeId));
  if (unreachable) {
    const name = (await readSessionName(dirPath)) ?? entry;
    return [{ name, pid: pidInfo.pid, status: "stale" }];
  }
  return probeLiveDaemon(dirPath, entry, paths, pidInfo.pid);
}

/**
 * List every session directory under `~/.real-a11y/sessions/` and probe the
 * daemon for live sessions. Empty directories left by a clean shutdown are
 * garbage-collected; stale pidfiles/sockets are reported as `stale`.
 */
export async function listSessions(): Promise<SessionStatus[]> {
  const root = join(homedir(), ".real-a11y", "sessions");
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  const result: SessionStatus[] = [];
  for (const entry of entries) {
    const dirPath = join(root, entry);
    const st = await stat(dirPath).catch(() => undefined);
    if (!st?.isDirectory()) continue;

    // Never inspect or delete another user's session directory.
    if (!isDirectoryOwnedByUs(st)) continue;

    result.push(...(await inspectSessionDir(dirPath, entry)));
  }

  return result;
}
