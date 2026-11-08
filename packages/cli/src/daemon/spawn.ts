/**
 * Locate the daemon socket / pidfile for a session name and start the daemon
 * when it isn't already listening.
 *
 * Also owns session lifecycle inspection (`listSessions`, `stopSession`,
 * `stopAllSessions`) and cross-platform socket path selection: Unix domain
 * sockets under `~/.real-a11y/sessions/<name>/daemon.sock` and Windows named
 * pipes under `\\.\pipe\real-a11y-<id>`, where the random id is stored in the
 * session directory's `pipe` file.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { registerCleanup } from "../cleanup.js";
import { CliError, EXIT } from "../exit.js";
import { CLI_VERSION } from "../version.js";

import {
  DaemonClient,
  DaemonTimeoutError,
  DaemonTransportError,
} from "./client.js";
import { isProcessAlive, readPidfile, waitForPidfile } from "./pidfile.js";
import { listSessions } from "./session-list.js";
import {
  defaultSessionName,
  isNamedPipe,
  isWindows,
  pathsForSessionDir,
  readPipeId,
  resolveWindowsSocketPath,
  sessionPaths,
  windowsPipePath,
  writeSessionName,
  type SessionPaths,
} from "./session-paths.js";
import { isDirectory, isStaleLock } from "./session-probe.js";
import { stopDaemonProcess, waitForSocketRelease } from "./stop-process.js";
import {
  isStaleConnectionError,
  isVersionCompatible,
} from "./version-check.js";
import { tightenWindowsTokenAcl } from "./windows-acl.js";

export { defaultSessionName, isNamedPipe, sessionPaths, type SessionPaths };
export { listSessions, type SessionStatus } from "./session-list.js";

async function acquireSessionLock(
  name: string,
  paths: SessionPaths,
  timeoutMs = 90_000,
): Promise<() => Promise<void>> {
  const lockPath = join(paths.sessionDir, ".lock");
  // Cold starts and version-mismatch replacements can take longer than a quick
  // handshake (socket probe + pidfile wait + browser spawn), so give the holder
  // a generous budget before treating the lock as stuck. Teardown paths use a
  // much shorter budget because they should fail fast, not wait for a browser.
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      // Write the payload atomically with wx so the file is never observed empty.
      const payload = JSON.stringify({
        pid: process.pid,
        startedAt: Date.now(),
      });
      await writeFile(lockPath, payload, {
        flag: "wx",
        mode: 0o600,
      });
      return async () => {
        // Only unlink the lock if we still own it. A concurrent start-up may
        // have re-created the session directory and taken a new lock after we
        // removed the directory; deleting that would break its mutual exclusion.
        try {
          const raw = await readFile(lockPath, "utf8");
          const data = JSON.parse(raw) as { pid?: number };
          if (data.pid !== process.pid) return;
        } catch {
          // lock is gone or unreadable; nothing to release
          return;
        }
        try {
          await rm(lockPath, { force: true });
        } catch {
          // lock may have been cleaned up by another process
        }
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        const stale = await isStaleLock(lockPath);
        if (stale) {
          try {
            await rm(lockPath, { force: true });
          } catch {
            // keep trying
          }
        }
        if (Date.now() > deadline) {
          throw new CliError(
            `session "${name}" is locked by another process; clear ${lockPath} if it is stale`,
          );
        }
        // Another process is spawning or has just finished; wait and then retry
        // the version handshake rather than racing it.
        await sleep(50);
      } else if (code === "ENOENT") {
        // The session directory may have been removed by a concurrent
        // `session stop`/`stop-all`; recreate it and try again.
        try {
          await mkdir(paths.sessionDir, { recursive: true, mode: 0o700 });
        } catch {
          // ignore and let the next iteration surface the real error
        }
        if (Date.now() > deadline) {
          throw new CliError(
            `session "${name}" directory disappeared while starting`,
            "stop concurrent `session stop` commands and retry",
          );
        }
        await sleep(50);
      } else {
        throw err;
      }
    }
  }
}

function waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = (): void => {
      const socket = createConnection(socketPath);
      let settled = false;
      socket.on("connect", () => {
        if (settled) return;
        settled = true;
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        if (settled) return;
        if (Date.now() > deadline) {
          settled = true;
          reject(
            new CliError(`daemon socket did not appear within ${timeoutMs}ms`),
          );
        } else {
          void setTimeout(attempt, 50);
        }
      });
    };
    attempt();
  });
}

async function removeSessionFiles(paths: SessionPaths): Promise<void> {
  await rm(paths.pidfile, { force: true });
  await rm(paths.tokenFile, { force: true });
  await rm(paths.pipeFile, { force: true });
  if (!isNamedPipe(paths.socketPath)) {
    await rm(paths.socketPath, { force: true });
  }
}

async function removeStaleSocket(paths: SessionPaths): Promise<void> {
  if (isNamedPipe(paths.socketPath)) {
    // Named pipes do not leave a filesystem artifact; a conflicting listener
    // is handled by the version handshake above.
    return;
  }
  try {
    await access(paths.socketPath);
    await rm(paths.socketPath, { force: true });
  } catch {
    // does not exist or inaccessible
  }
}

/**
 * Return a client connected to the daemon for `name`, spawning it if necessary.
 *
 * Performs a version handshake and replaces stale or mismatched daemons.
 */
export async function ensureDaemonClient(
  name: string,
  daemonPath: string,
  idleTimeoutMs = 900_000,
): Promise<DaemonClient> {
  const paths = sessionPaths(name);

  // Serialize concurrent first-use attempts as the very first filesystem
  // operation. `acquireSessionLock` creates the session directory if needed, so
  // we never leave an unlocked empty directory that `listSessions()` could
  // mistake for a clean-shutdown leftover and delete.
  const release = await acquireSessionLock(name, paths);
  const unregisterCleanup = registerCleanup(release);

  try {
    // Make sure the directory is created and owner-only before writing any
    // session metadata or the auth token. A failed chmod is not silently ignored
    // because an insecure directory would expose the token to other local users.
    await mkdir(paths.sessionDir, { recursive: true, mode: 0o700 });
    try {
      await chmod(paths.sessionDir, 0o700);
    } catch (err) {
      throw new CliError(
        `could not secure session directory ${paths.sessionDir}: ${err instanceof Error ? err.message : String(err)}`,
        "check that you own the directory",
        EXIT.ERROR,
      );
    }
    await writeSessionName(paths.sessionDir, name);

    // Reuse an existing auth token if the session already has one so we can
    // probe a live daemon before deciding whether to respawn. Read it inside
    // the lock so a token another process just wrote is picked up.
    let existingToken: string | undefined;
    try {
      existingToken = (await readFile(paths.tokenFile, "utf8")).trim();
    } catch {
      // still no token
    }

    if (isWindows()) {
      const existingPipeId = await readPipeId(paths);
      if (existingPipeId) {
        paths.socketPath = windowsPipePath(existingPipeId);
      }
    }

    const probeClient = new DaemonClient({
      socketPath: paths.socketPath,
      authToken: existingToken,
      tokenFile: paths.tokenFile,
    });

    // Probe the socket. A compatible daemon can be reused; a stale socket or
    // incompatible/shutting-down daemon must be stopped before we respawn.
    let version: Awaited<ReturnType<DaemonClient["version"]>> | undefined;
    let versionErr: unknown;
    try {
      version = await probeClient.version();
    } catch (err) {
      versionErr = err;
    }

    if (!versionErr && version && isVersionCompatible(version)) {
      return probeClient;
    }

    if (versionErr && isStaleConnectionError(versionErr)) {
      // Nothing is listening on the socket; fall through to clean up and respawn.
    } else if (versionErr) {
      // The socket answered but the handshake failed (timeout, auth mismatch,
      // or protocol error). Don't unlink it yet — try to stop the process via
      // the pidfile. If there is no pidfile, fail safe and let the user
      // diagnose instead of stranding a live daemon.
      const pidInfo = await readPidfile(paths.pidfile);
      if (pidInfo && isProcessAlive(pidInfo.pid)) {
        const exited = await stopDaemonProcess(
          paths,
          pidInfo.pid,
          pidInfo.startedAt,
          existingToken,
        );
        if (!exited) {
          throw new CliError(
            `existing daemon process for session "${name}" could not be stopped`,
            "run 'real-a11y session stop <name>' and retry",
            EXIT.ERROR,
          );
        }
      } else {
        throw versionErr;
      }
    } else {
      // Version mismatch or the daemon is already shutting down: stop the running
      // daemon and respawn below.
      const pidInfo = await readPidfile(paths.pidfile);
      if (pidInfo && isProcessAlive(pidInfo.pid)) {
        const exited = await stopDaemonProcess(
          paths,
          pidInfo.pid,
          pidInfo.startedAt,
          existingToken,
        );
        if (!exited) {
          throw new CliError(
            `existing daemon process for session "${name}" could not be stopped`,
            "run 'real-a11y session stop <name>' and retry",
            EXIT.ERROR,
          );
        }
      } else {
        // Daemon is responding but has no pidfile; ask it to quit and wait for
        // the socket to release.
        try {
          await probeClient.quit();
        } catch {
          // quit is unavailable in very old daemons.
        }
        await waitForSocketRelease(paths.socketPath, 15_000);
      }
    }

    // If a pidfile points at a live process, stop it and clean up its files.
    const pidInfo = await readPidfile(paths.pidfile);
    if (pidInfo && isProcessAlive(pidInfo.pid)) {
      const exited = await stopDaemonProcess(
        paths,
        pidInfo.pid,
        pidInfo.startedAt,
        existingToken,
      );
      if (!exited) {
        throw new CliError(
          `existing daemon process for session "${name}" could not be stopped`,
          "run 'real-a11y session stop <name>' and retry",
          EXIT.ERROR,
        );
      }
    }

    await removeSessionFiles(paths);
    await removeStaleSocket(paths);

    const authToken = randomBytes(32).toString("hex");
    if (isWindows()) {
      const pipeId = randomBytes(16).toString("hex");
      paths.socketPath = windowsPipePath(pipeId);
      // Recreate the pipe-id file with the requested mode; the id is not a
      // secret (the pipe name is enumerable anyway) but the directory is
      // per-user and there is no reason to be looser than the token file.
      await rm(paths.pipeFile, { force: true });
      await writeFile(paths.pipeFile, pipeId, { mode: 0o600 });
    }

    // Remove the old token so writeFile creates a new file with the requested
    // mode. If the file cannot be removed, the write/chmod below will surface it.
    await rm(paths.tokenFile, { force: true });
    await writeFile(paths.tokenFile, authToken, { mode: 0o600 });
    // Tighten permissions; do not silently ignore a failure that would leave the
    // token readable by other local users.
    await chmod(paths.tokenFile, 0o600);
    // On Windows, `chmod` has no effect, so require an explicit token-file ACL.
    // A failure here prevents the daemon from starting with a world-readable
    // auth token.
    await tightenWindowsTokenAcl(paths.tokenFile);

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
        "--daemon-version",
        CLI_VERSION,
        "--token-file",
        paths.tokenFile,
      ],
      {
        detached: true,
        stdio: "ignore",
      },
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
    // Wait for the daemon to write its pidfile before releasing the start-up
    // lock, so a concurrent `session list` does not mistake a live but not-yet
    // registered daemon for a clean-shutdown leftover and delete its socket.
    await waitForPidfile(paths.pidfile, 15_000);
    return new DaemonClient({ socketPath: paths.socketPath, authToken });
  } finally {
    unregisterCleanup();
    await release();
  }
}

export async function resolveSessionPaths(name: string): Promise<SessionPaths> {
  const fromName = sessionPaths(name);
  if (await isDirectory(fromName.sessionDir)) return fromName;

  // `name` may already be a sanitized directory name from `session list` output,
  // but we must still reject traversal such as `..` or `.`.
  const root = join(homedir(), ".real-a11y", "sessions");
  const base = basename(name);
  const direct = join(root, base);
  if (base !== "" && base !== "." && base !== ".." && direct !== root) {
    const resolvedRoot = await realpath(root).catch(() => root);
    const resolvedDirect = await realpath(direct).catch(() => direct);
    if (
      resolvedDirect === resolvedRoot ||
      resolvedDirect.startsWith(resolvedRoot + sep)
    ) {
      if (await isDirectory(direct)) return pathsForSessionDir(direct);
    }
  }

  return fromName;
}

export type StopSessionResult = "stopped" | "not-running" | "locked" | "failed";

/**
 * Stop the daemon for `name` and remove its session directory.
 */
export async function stopSession(name: string): Promise<StopSessionResult> {
  const paths = await resolveSessionPaths(name);

  // Serialize with any in-progress `ensureDaemonClient` so we don't delete the
  // session directory (and its `.lock`) while a daemon is still starting. Use a
  // short timeout: stop should fail fast, not wait for a full browser launch.
  let release: (() => Promise<void>) | undefined;
  try {
    release = await acquireSessionLock(name, paths, 5_000);
  } catch {
    return "locked";
  }

  try {
    const token = (
      await readFile(paths.tokenFile, "utf8").catch(() => undefined)
    )?.trim();
    if (isWindows()) {
      paths.socketPath = resolveWindowsSocketPath(
        paths.socketPath,
        await readPipeId(paths),
      );
    }

    const pidInfo = await readPidfile(paths.pidfile);

    let found = false;
    if (pidInfo && isProcessAlive(pidInfo.pid)) {
      found = true;
      const exited = await stopDaemonProcess(
        paths,
        pidInfo.pid,
        pidInfo.startedAt,
        token,
      );
      if (!exited) return "failed";
    } else if (pidInfo) {
      // The pidfile exists but the process is already gone: this is a stale
      // session. We are about to clean up its files, so report it as stopped.
      found = true;
    } else if (!pidInfo) {
      // The pidfile may be missing or unwritten yet; fall back to a socket probe
      // so we don't `rm -rf` a live daemon's files. Only a transport-level "not
      // listening" error means the daemon is absent; anything else (timeout,
      // auth/command error, etc.) means a daemon answered and we should not delete
      // its bookkeeping.
      const client = new DaemonClient({
        socketPath: paths.socketPath,
        authToken: token,
        tokenFile: paths.tokenFile,
      });
      try {
        await client.quit();
        found = true;
      } catch (err) {
        if (err instanceof DaemonTimeoutError) return "failed";
        if (err instanceof DaemonTransportError) {
          // not listening
        } else {
          return "failed";
        }
      }
      if (found) {
        try {
          await waitForSocketRelease(paths.socketPath, 15_000);
        } catch {
          return "failed";
        }
      }
    }

    try {
      await rm(paths.sessionDir, { recursive: true, force: true });
    } catch (err) {
      // `force` suppresses ENOENT but not EBUSY/EPERM — e.g. Windows while
      // another process still holds a handle inside the directory. The daemon
      // (if any) is already stopped at this point, so surface a precise error
      // instead of letting run.ts report it as an unexpected failure.
      throw new CliError(
        `could not remove session directory ${paths.sessionDir}: ${err instanceof Error ? err.message : String(err)}`,
        "close any program holding files in the directory, then remove it and retry",
      );
    }
    return found ? "stopped" : "not-running";
  } finally {
    if (release) await release();
  }
}

export interface StopAllResult {
  stopped: number;
  locked: number;
  notRunning: number;
  failed: number;
}

/**
 * Stop every session daemon and remove their session directories.
 */
export async function stopAllSessions(): Promise<StopAllResult> {
  const sessions = await listSessions();
  // One session's failure (e.g. an unremovable directory) must not abort the
  // batch or discard the other sessions' outcomes — map a rejection to
  // `failed` so the stopped/locked/failed summary keeps its contract.
  const statuses = await Promise.allSettled(
    sessions.map((session) => stopSession(session.name)),
  );
  const result: StopAllResult = {
    stopped: 0,
    locked: 0,
    notRunning: 0,
    failed: 0,
  };
  for (const status of statuses) {
    if (status.status === "rejected") {
      result.failed++;
    } else if (status.value === "stopped") result.stopped++;
    else if (status.value === "locked") result.locked++;
    else if (status.value === "not-running") result.notRunning++;
    else result.failed++;
  }
  return result;
}
