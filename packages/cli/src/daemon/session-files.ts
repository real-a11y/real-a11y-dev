/**
 * Teardown of a daemon's on-disk session files (socket, pidfile, token, log).
 *
 * Split out of `server.ts`. Cleanup runs under the same `.lock` the spawner
 * takes at startup, and only deletes files whose pidfile still names this
 * process, so a replacement daemon starting concurrently is never clobbered.
 */

import { readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join as pathJoin } from "node:path";

function isNamedPipePath(path: string): boolean {
  return path.startsWith("\\\\.\\pipe\\");
}

async function ownsPidfile(pidfile: string): Promise<boolean> {
  try {
    const raw = await readFile(pidfile, "utf8");
    const parsed = JSON.parse(raw) as { pid?: unknown };
    return (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      parsed.pid === process.pid
    );
  } catch {
    return false;
  }
}

async function isStaleLock(lockPath: string): Promise<boolean> {
  try {
    const raw = await readFile(lockPath, "utf8");
    const data = JSON.parse(raw) as { pid?: number; startedAt?: number };
    if (typeof data.pid === "number") {
      try {
        process.kill(data.pid, 0);
        return false;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EPERM") return false;
        return true;
      }
    }
  } catch {
    return true;
  }
  return true;
}

async function claimCleanupLock(
  sessionDir: string,
): Promise<(() => Promise<void>) | undefined> {
  const lockPath = pathJoin(sessionDir, ".lock");
  const deadline = Date.now() + 500;
  while (Date.now() <= deadline) {
    try {
      await writeFile(
        lockPath,
        JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
        { flag: "wx", mode: 0o600 },
      );
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await rm(lockPath, { force: true }).catch(() => 0);
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        if (await isStaleLock(lockPath)) {
          await rm(lockPath, { force: true }).catch(() => 0);
          continue;
        }
        // A live process (likely a replacement daemon start) holds the lock.
        return undefined;
      }
      // Unknown filesystem error: proceed without a lock, but return a no-op.
      return async () => {};
    }
  }
  return undefined;
}

/** Remove the socket, pidfile and sibling files of a session this process owns. */
export async function removeOwnSessionFiles(
  pidfile: string,
  socketPath: string,
): Promise<void> {
  const sessionDir = dirname(pidfile);

  // A concurrent `ensureDaemonClient` replacement may be starting.  Take
  // the same `.lock` used for startup; if a live process holds it, skip
  // cleanup and let that process own the session directory.
  const release = await claimCleanupLock(sessionDir);
  if (!release) return;
  try {
    // Snapshot ownership once while the lock protects us from replacement
    // daemons; re-reading after we delete the pidfile would abort cleanup.
    const ours = await ownsPidfile(pidfile);
    if (!ours) return;

    if (!isNamedPipePath(socketPath)) {
      await rm(socketPath, { force: true }).catch(() => 0);
    }
    await rm(pidfile, { force: true }).catch(() => 0);

    for (const file of ["daemon.log", "token", "pipe", "name.txt"]) {
      await rm(pathJoin(sessionDir, file), { force: true }).catch(() => 0);
    }

    // Release the lock and remove the lock file so the directory can be
    // removed. The release is idempotent; if a replacement has already
    // claimed the session, `rmdir` will fail and `session list` / `session stop`
    // will diagnose it.
    await release();
  } finally {
    await release();
  }

  try {
    await rmdir(sessionDir);
  } catch {
    // Not empty (e.g. a concurrent start left a .lock) — leave it for
    // `session list` / `session stop` to diagnose.
  }
}
