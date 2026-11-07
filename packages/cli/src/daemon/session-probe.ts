/**
 * Filesystem and socket probes shared by session spawn and session listing.
 */

import { readFile, stat } from "node:fs/promises";
import { createConnection } from "node:net";

import { isProcessAlive } from "./pidfile.js";

export async function isStaleLock(
  lockPath: string,
  { unreadableGraceMs = 5_000 } = {},
): Promise<boolean> {
  const st = await stat(lockPath).catch(() => undefined);
  if (!st) return true;
  const now = Date.now();
  const freshByMtime = now - st.mtimeMs < unreadableGraceMs;
  let data: { pid?: number; startedAt?: number };
  try {
    const raw = await readFile(lockPath, "utf8");
    data = JSON.parse(raw) as { pid?: number; startedAt?: number };
  } catch {
    // If we cannot read or parse a recent lock, assume a writer is still active.
    return !freshByMtime;
  }
  const pidAlive = typeof data.pid === "number" && isProcessAlive(data.pid);
  if (pidAlive) return false;
  // Give the holder a short grace period before we assume it crashed.
  const fresh =
    typeof data.startedAt === "number" && now - data.startedAt < 5_000;
  return !fresh;
}

export async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export function isDirectoryOwnedByUs(st: { uid: number }): boolean {
  if (typeof process.getuid !== "function") return true;
  return st.uid === process.getuid();
}

export async function isSocketPresent(socketPath: string): Promise<boolean> {
  // A leftover socket file from a crashed daemon is not "present" in the sense
  // we care about; only report it if a daemon is actually listening.
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(false);
    }, 500);

    socket.on("connect", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(false);
    });
  });
}
