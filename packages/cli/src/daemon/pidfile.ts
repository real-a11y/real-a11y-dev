/**
 * Pidfile parsing and process-liveness helpers for the daemon spawner.
 *
 * Split out of `spawn.ts`. Nothing here touches the socket or the session
 * lock; it only reads the pidfile and asks the OS whether a PID is alive.
 */

import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { DaemonTransportError } from "./client.js";

export interface Pidfile {
  pid: number;
  startedAt?: number;
  daemonVersion?: string;
  protocolVersion?: string;
}

function isValidPid(pid: unknown): pid is number {
  return (
    typeof pid === "number" &&
    Number.isInteger(pid) &&
    pid > 0 &&
    pid <= 2147483647
  );
}

export async function readPidfile(
  pidfile: string,
): Promise<Pidfile | undefined> {
  try {
    const raw = await readFile(pidfile, "utf8");
    const data = JSON.parse(raw) as Partial<Pidfile>;
    if (isValidPid(data.pid)) return data as Pidfile;
  } catch {
    // missing, unreadable, or malformed pidfile is treated as no pidfile.
  }
  return undefined;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we cannot signal it.
    if (
      err instanceof Error &&
      (err as NodeJS.ErrnoException).code === "EPERM"
    ) {
      return true;
    }
    return false;
  }
}

export async function waitForProcessExit(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (isProcessAlive(pid) && Date.now() < deadline) {
    await sleep(100);
  }
  return !isProcessAlive(pid);
}

export async function waitForPidfile(
  pidfile: string,
  timeoutMs: number,
): Promise<Pidfile> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pidInfo = await readPidfile(pidfile);
    if (pidInfo) return pidInfo;
    await sleep(20);
  }
  throw new DaemonTransportError(
    `daemon did not write its pidfile within ${timeoutMs}ms`,
  );
}
