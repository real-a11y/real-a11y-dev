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

import { execFileSync, execSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  realpath,
  readdir,
  rmdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir, platform, userInfo } from "node:os";
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
import { DAEMON_PROTOCOL_VERSION } from "./protocol.js";
import { tightenWindowsTokenAcl } from "./windows-acl.js";

export interface SessionPaths {
  socketPath: string;
  pidfile: string;
  logFile: string;
  tokenFile: string;
  /** Windows only: holds the random id the named pipe's name is built from. */
  pipeFile: string;
  sessionDir: string;
}

function isWindows(): boolean {
  return platform() === "win32";
}

function sanitizeSessionName(name: string): string {
  // Replace path separators / shell metacharacters, then append a short hash of
  // the original so distinct names such as "team/prod" and "team_prod" don't
  // collide when sanitized.
  const base = name.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 55);
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 8);
  return `${base}_${hash}`;
}

function currentUser(): string {
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

function windowsPipePath(pipeId: string): string {
  // The pipe name is discoverable by any local process that can enumerate
  // `\\.\pipe\`, so it must be independent of the auth token — a hash of the
  // secret in a public name would hand a local attacker an offline oracle for
  // verifying guessed tokens. The id is random, generated at spawn time, and
  // stored in the session directory's `pipe` file so later invocations can
  // find the pipe; the token is still required for every RPC `auth` message.
  return `\\\\.\\pipe\\real-a11y-${pipeId}`;
}

function resolveWindowsSocketPath(
  basePath: string,
  pipeId: string | undefined,
): string {
  return pipeId ? windowsPipePath(pipeId) : basePath;
}

async function readPipeId(paths: SessionPaths): Promise<string | undefined> {
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

function pathsForSessionDir(dir: string): SessionPaths {
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

async function writeSessionName(
  sessionDir: string,
  name: string,
): Promise<void> {
  await mkdir(sessionDir, { recursive: true, mode: 0o700 });
  await writeFile(join(sessionDir, "name.txt"), name, { mode: 0o600 });
}

async function readSessionName(
  sessionDir: string,
): Promise<string | undefined> {
  try {
    return (await readFile(join(sessionDir, "name.txt"), "utf8")).trim();
  } catch {
    return undefined;
  }
}

async function isStaleLock(
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

/** Wait until nothing is listening on `socketPath` (connect starts failing). */
function waitForSocketRelease(
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

interface Pidfile {
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

async function readPidfile(pidfile: string): Promise<Pidfile | undefined> {
  try {
    const raw = await readFile(pidfile, "utf8");
    const data = JSON.parse(raw) as Partial<Pidfile>;
    if (isValidPid(data.pid)) return data as Pidfile;
  } catch {
    // missing, unreadable, or malformed pidfile is treated as no pidfile.
  }
  return undefined;
}

function isProcessAlive(pid: number): boolean {
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

async function waitForProcessExit(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (isProcessAlive(pid) && Date.now() < deadline) {
    await sleep(100);
  }
  return !isProcessAlive(pid);
}

async function waitForPidfile(
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

interface VersionInfo {
  daemonVersion: string;
  protocolVersion: string;
  sessionCount: number;
  shuttingDown?: boolean;
}

function isStaleConnectionError(err: unknown): boolean {
  // A timeout means the daemon is alive but slow; don't treat it as a stale
  // socket we can safely unlink.
  if (err instanceof DaemonTimeoutError) return false;
  if (err instanceof DaemonTransportError) return true;
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ECONNREFUSED" || code === "ENOENT") return true;
  return /ECONNREFUSED|ENOENT/.test(err.message);
}

function isVersionCompatible(version: VersionInfo): boolean {
  // A daemon that is already shutting down is not a candidate for reuse; the
  // client should wait for it to exit and then respawn.
  if (version.shuttingDown) return false;
  const protocolOk = version.protocolVersion === DAEMON_PROTOCOL_VERSION;
  // A "0.0.0" version (fallback when package.json cannot be located) should not
  // force endless respawns; treat it as a wildcard.
  const daemonVersion =
    version.daemonVersion === "0.0.0" ? CLI_VERSION : version.daemonVersion;
  return protocolOk && daemonVersion === CLI_VERSION;
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

async function processStartTimeMs(pid: number): Promise<number | undefined> {
  if (process.platform === "win32") return processStartTimeMsWindows(pid);
  if (process.platform === "darwin") return processStartTimeMsDarwin(pid);
  return processStartTimeMsLinux(pid);
}

async function processStartTimeMsLinux(
  pid: number,
): Promise<number | undefined> {
  try {
    // Parse /proc/<pid>/stat for starttime (field 22, in clock ticks since boot).
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    if (closeParen === -1) return undefined;
    const after = stat.slice(closeParen + 1).trim();
    const fields = after.split(/\s+/);
    if (fields.length < 22) return undefined;
    const starttimeTicks = Number(fields[19]);
    if (!Number.isFinite(starttimeTicks)) return undefined;

    const bootTimeSec = getBootTimeSec();
    const clockTick = getClockTick();
    if (bootTimeSec !== undefined && clockTick !== undefined) {
      return Math.round((bootTimeSec + starttimeTicks / clockTick) * 1000);
    }
  } catch {
    // Fall through to the filesystem/ps fallbacks below.
  }

  // Fallback 1: /proc/<pid> is created when the process starts, so its ctime
  // is a reliable proxy even when /proc/stat btime or CLK_TCK are unavailable.
  try {
    const st = await stat(`/proc/${pid}`);
    if (st.ctimeMs) return st.ctimeMs;
  } catch {
    // ignore
  }

  // Fallback 2: `ps` may still work in restricted containers.
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    const ms = new Date(out).getTime();
    if (!Number.isNaN(ms)) return ms;
  } catch {
    // ignore
  }

  // Fallback 3: `ps -o etime=` gives elapsed time, from which we can compute
  // an approximate start time. This is less precise but works when lstart is
  // unavailable.
  const elapsed = psElapsedMs(pid);
  if (elapsed !== undefined) return Date.now() - elapsed;

  return undefined;
}

function psElapsedMs(pid: number): number | undefined {
  try {
    const out = execFileSync("ps", ["-o", "etime=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    return parseEtime(out);
  } catch {
    return undefined;
  }
}

function parseEtime(etime: string): number | undefined {
  const m = etime.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return undefined;
  const days = Number(m[1] || 0);
  const hours = m[2] ? Number(m[2]) : 0;
  const minutes = Number(m[3]);
  const seconds = Number(m[4]);
  if (
    Number.isNaN(days) ||
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    Number.isNaN(seconds)
  ) {
    return undefined;
  }
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

function getBootTimeSec(): number | undefined {
  try {
    const stat = readFileSync("/proc/stat", "utf8");
    const line = stat.split("\n").find((l) => l.startsWith("btime "));
    if (!line) return undefined;
    const sec = Number(line.split(/\s+/)[1]);
    return Number.isFinite(sec) ? sec : undefined;
  } catch {
    return undefined;
  }
}

function getClockTick(): number | undefined {
  try {
    const out = execSync("getconf CLK_TCK", { encoding: "utf8" }).trim();
    const tick = Number(out);
    return Number.isFinite(tick) && tick > 0 ? tick : undefined;
  } catch {
    return 100;
  }
}

function processStartTimeMsDarwin(pid: number): number | undefined {
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    const ms = new Date(out).getTime();
    if (!Number.isNaN(ms)) return ms;
  } catch {
    // ignore
  }

  // Fallback to elapsed time when start time is unavailable.
  const elapsed = psElapsedMs(pid);
  if (elapsed !== undefined) return Date.now() - elapsed;

  return undefined;
}

function processStartTimeMsWindows(pid: number): number | undefined {
  try {
    const pidStr = String(pid);
    const command =
      `(Get-Process -Id ${pidStr} -ErrorAction SilentlyContinue)` +
      ".StartTime.ToUniversalTime().ToString('yyyyMMddHHmmssfff')";
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", command],
      { encoding: "utf8", timeout: 3000 },
    ).trim();
    if (/^\d{17}$/.test(out)) {
      const y = Number(out.slice(0, 4));
      const mo = Number(out.slice(4, 6)) - 1;
      const d = Number(out.slice(6, 8));
      const h = Number(out.slice(8, 10));
      const mi = Number(out.slice(10, 12));
      const s = Number(out.slice(12, 14));
      const ms = Number(out.slice(14, 17));
      return Date.UTC(y, mo, d, h, mi, s, ms);
    }
  } catch {
    // ignore
  }
  return undefined;
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

async function stopDaemonProcess(
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

  if (identity === "different") {
    // The PID in the pidfile has been reused by another process. Only stop the
    // session if the socket is still answering our handshake; otherwise the
    // pidfile is stale and we can clean up without sending signals.
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
    let version: VersionInfo | undefined;
    let versionErr: unknown;
    try {
      version = (await probeClient.version()) as VersionInfo;
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

    const paths = pathsForSessionDir(dirPath);
    let token: string | undefined;
    let pipeId: string | undefined;
    if (isWindows()) {
      token = await readFile(paths.tokenFile, "utf8").catch(() => undefined);
      pipeId = await readPipeId(paths);
      paths.socketPath = resolveWindowsSocketPath(paths.socketPath, pipeId);
    }
    const pidInfo = await readPidfile(paths.pidfile);
    if (!pidInfo) {
      // A daemon may be starting up and has not written its pidfile yet. Use a
      // generous grace for an unreadable lock so a slow start is not mistaken
      // for a stale one in this destructive path.
      const lockPath = join(dirPath, ".lock");
      const locked = !(await isStaleLock(lockPath, {
        unreadableGraceMs: 30_000,
      }).catch(() => true));
      if (!locked) {
        // No pidfile and no live lock. If a socket file still exists, a daemon
        // is probably still starting; leave it alone. Otherwise this is a
        // clean-shutdown or crashed session. Preserve the directory (and its
        // daemon.log) so post-mortem debugging is possible; `session stop` /
        // `stop-all` remove the directory on request.
        if (await isSocketPresent(paths.socketPath)) {
          const name = (await readSessionName(dirPath)) ?? entry;
          result.push({ name, pid: undefined, status: "starting" });
          continue;
        }
        const logExists = await stat(paths.logFile)
          .then((s) => s.isFile())
          .catch(() => false);
        if (logExists) {
          const name = (await readSessionName(dirPath)) ?? entry;
          result.push({ name, pid: undefined, status: "stale" });
          continue;
        }
        // Only remove the directory if it is empty. A non-empty directory
        // without a pidfile/socket/log is a failed start; report it as stale so
        // `session stop` / `stop-all` can clean it up, since `rmdir` alone
        // cannot remove it.
        try {
          await rmdir(dirPath);
        } catch {
          const name = (await readSessionName(dirPath)) ?? entry;
          result.push({ name, pid: undefined, status: "stale" });
        }
        continue;
      }
      const name = (await readSessionName(dirPath)) ?? entry;
      result.push({
        name,
        pid: undefined,
        status: "starting",
      });
      continue;
    }

    if (!isProcessAlive(pidInfo.pid)) {
      // The pidfile points at a dead process: the daemon crashed or was killed.
      // Keep the directory (and its daemon.log) so the user can diagnose it;
      // only an explicit `session stop` / `stop-all` removes it.
      const name = (await readSessionName(dirPath)) ?? entry;
      result.push({ name, pid: pidInfo.pid, status: "stale" });
      continue;
    }

    if (isWindows() && (!token?.trim() || !pipeId)) {
      // On Windows the pipe name lives in the session's `pipe` file and the
      // token authenticates every RPC. Without either file we cannot reach or
      // authenticate the daemon; treat the session as stale so it can be
      // stopped/cleaned.
      const name = (await readSessionName(dirPath)) ?? entry;
      result.push({ name, pid: pidInfo.pid, status: "stale" });
      continue;
    }

    const client = new DaemonClient({
      socketPath: paths.socketPath,
      tokenFile: paths.tokenFile,
    });
    try {
      const sessions = await client.list();
      if (sessions.length === 0) {
        // Daemon is alive but has no sessions yet (or just finished stop-all).
        const name = (await readSessionName(dirPath)) ?? entry;
        result.push({
          name,
          pid: pidInfo.pid,
          status: "running",
          url: undefined,
          createdAt: undefined,
          lastUsedAt: undefined,
          busy: false,
        });
      }
      for (const info of sessions) {
        result.push({
          name: info.name,
          pid: pidInfo.pid,
          status: "running",
          url: info.url,
          createdAt: info.createdAt,
          lastUsedAt: info.lastUsedAt,
          busy: info.busy,
        });
      }
    } catch {
      const name = (await readSessionName(dirPath)) ?? entry;
      result.push({ name, pid: pidInfo.pid, status: "starting" });
    }
  }

  return result;
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

function isDirectoryOwnedByUs(st: { uid: number }): boolean {
  if (typeof process.getuid !== "function") return true;
  return st.uid === process.getuid();
}

async function isSocketPresent(socketPath: string): Promise<boolean> {
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
