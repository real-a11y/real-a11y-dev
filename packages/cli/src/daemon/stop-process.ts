/**
 * Stopping a running session daemon: verify the recorded PID still belongs to
 * our daemon, ask it to quit over the socket, and escalate to signals only when
 * the process identity is proven.
 */

import { createConnection } from "node:net";

import { CliError } from "../exit.js";

import { DaemonClient, DaemonTimeoutError } from "./client.js";
import { isProcessAlive, waitForProcessExit } from "./pidfile.js";
import { processStartTimeMs } from "./process-start-time.js";
import type { SessionPaths } from "./session-paths.js";

/** Wait until nothing is listening on `socketPath` (connect starts failing). */
export function waitForSocketRelease(
  socketPath: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = (): void => {
      const socket = createConnection(socketPath);
      let settled = false;
      socket.on("connect", () => {
        if (settled) return;
        settled = true;
        socket.end();
        if (Date.now() > deadline) {
          reject(
            new CliError(
              `daemon socket did not release within ${timeoutMs}ms`,
              "run 'real-a11y session stop <name>' and retry",
            ),
          );
        } else {
          void setTimeout(attempt, 100);
        }
      });
      socket.on("error", () => {
        if (settled) return;
        settled = true;
        resolve();
      });
    };
    attempt();
  });
}

type ProcessIdentity = "same" | "different" | "unknown";

async function isSameDaemonProcess(
  pid: number,
  startedAt?: number,
): Promise<ProcessIdentity> {
  if (startedAt === undefined) {
    // Old-format pidfiles lack `startedAt`. A dead PID is definitely stale;
    // a live one still needs socket proof before we signal it.
    if (!isProcessAlive(pid)) return "different";
    return "unknown";
  }
  const startTime = await processStartTimeMs(pid);
  if (startTime === undefined) return "unknown";
  // Allow a few seconds of clock skew between the daemon's Date.now() and the
  // kernel's proc ctime.
  return Math.abs(startTime - startedAt) < 10_000 ? "same" : "different";
}

/**
 * The recorded PID was reused by another process. Only stop the session if the
 * socket still answers our handshake; otherwise the pidfile is stale and we can
 * clean up without sending signals.
 */
async function stopViaSocketOnly(
  paths: SessionPaths,
  client: DaemonClient,
): Promise<boolean> {
  try {
    await client.version();
  } catch {
    // no daemon listening; pidfile is stale.
    return true;
  }
  try {
    await client.quit();
    await waitForSocketRelease(paths.socketPath, 15_000);
    return true;
  } catch {
    return false;
  }
}

/** Wait for the daemon to exit, escalating SIGTERM then SIGKILL when proven ours. */
async function waitForDaemonExit(
  pid: number,
  startedAt: number | undefined,
  socketConfirmed: boolean,
): Promise<boolean> {
  // The daemon's quit/SIGTERM path awaits browser shutdown, which can take
  // longer than a quick RPC. Wait a generous grace period before escalating.
  let exited = await waitForProcessExit(pid, 30_000);
  if (!exited) {
    const stillSame = await isSameDaemonProcess(pid, startedAt);
    if (stillSame === "same" || (stillSame === "unknown" && socketConfirmed)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already gone or no permission
      }
      exited = await waitForProcessExit(pid, 15_000);
      if (!exited) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already gone or no permission
        }
        exited = await waitForProcessExit(pid, 5_000);
      }
    }
  }

  return exited;
}

export async function stopDaemonProcess(
  paths: SessionPaths,
  pid: number,
  startedAt?: number,
  authToken?: string,
): Promise<boolean> {
  const identity = await isSameDaemonProcess(pid, startedAt);

  const client = new DaemonClient({
    socketPath: paths.socketPath,
    authToken,
    tokenFile: paths.tokenFile,
  });

  if (identity === "different") return stopViaSocketOnly(paths, client);

  // When we cannot verify the process identity by start time, demand socket
  // proof before we send signals to an arbitrary PID. A PID confirmed by start
  // time is known to be our daemon, so it can be signalled without that proof.
  let socketConfirmed = false;
  try {
    await client.version();
    socketConfirmed = true;
    await client.quit();
  } catch (err) {
    if (!socketConfirmed && identity !== "same") {
      if (err instanceof DaemonTimeoutError) {
        // The daemon may be alive but too slow to answer; don't risk signalling a
        // PID we can't identify.
        return false;
      }
      // Without a live socket or a verified start time, the recorded PID may
      // have been recycled; do not signal an arbitrary process.
      return false;
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch (killErr) {
      // EPERM means the process exists but we cannot signal it (another user's
      // process); fail closed rather than orphan it or kill a stranger.
      if (
        killErr instanceof Error &&
        (killErr as NodeJS.ErrnoException).code === "EPERM"
      ) {
        return false;
      }
      // ESRCH means already gone; the wait below will confirm.
    }
  }

  return waitForDaemonExit(pid, startedAt, socketConfirmed);
}
