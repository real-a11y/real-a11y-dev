/**
 * NDJSON RPC server for the session daemon.
 *
 * Listens on a Unix domain socket (or, on Windows, a named pipe) and dispatches
 * `run` requests against named sessions held by the {@link SessionRegistry}.
 *
 * Output capture: commands write to the global `process.stdout`/`stderr`
 * streams, so the server serialises `run` calls and temporarily redirects
 * those streams into per-request RPC messages. This costs no parallelism —
 * each daemon process hosts exactly one named session (`spawn.ts` derives one
 * socket per session name), so concurrent sessions live in separate daemons.
 */

import { timingSafeEqual } from "node:crypto";
import { chmodSync } from "node:fs";
import { readFile, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, isAbsolute, join as pathJoin } from "node:path";

import type { BrowserSession } from "@real-a11y-dev/browser";

import { sessionFlags } from "../commands/common.js";
import { clearConfigCache } from "../config.js";
import { CliError, DaemonShutdownError, EXIT } from "../exit.js";

import { createSession, type SessionFlags } from "../session.js";

import { ALLOWED_ENV_OVERRIDES, isAllowedEnvKey } from "./env-allowlist.js";
import {
  DAEMON_PROTOCOL_VERSION,
  type RpcMessage,
  type RpcRequest,
  type RpcStream,
  encodeRpc,
  decodeRpc,
} from "./protocol.js";
import { SessionRegistry } from "./registry.js";
import { resolveCommandTargets, runCommandOnSession } from "./runner.js";

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

function withEnvSnapshot(
  env: Record<string, string | undefined | null> | undefined,
): () => void {
  if (!env) {
    delete process.env.REAL_A11Y_MCP_ALLOW_FILE;
    return () => {
      delete process.env.REAL_A11Y_MCP_ALLOW_FILE;
    };
  }

  // Build the full set of keys we are going to manage: the caller may only
  // provide some of them, but we also clear all other allow-listed keys so a
  // value inherited from the daemon's spawning shell doesn't leak into a later
  // run whose caller didn't set it.
  const keysToManage = new Set<string>(ALLOWED_ENV_OVERRIDES);
  for (const key of Object.keys(env)) {
    if (isAllowedEnvKey(key)) keysToManage.add(key);
  }

  // Clear any GITHUB_/PLAYWRIGHT_ keys currently set that the caller did not
  // send, so they don't leak from one shell into another.
  for (const key of Object.keys(process.env)) {
    if (
      (key.startsWith("GITHUB_") || key.startsWith("PLAYWRIGHT_")) &&
      !(key in env)
    ) {
      keysToManage.add(key);
    }
  }

  const previous = new Map<string, string | undefined>();
  for (const key of keysToManage) {
    previous.set(key, process.env[key]);
    const value = env[key];
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const key of previous.keys()) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function chunkToString(chunk: unknown, encoding?: unknown): string {
  if (Buffer.isBuffer(chunk)) return chunk.toString(encoding as BufferEncoding);
  if (typeof chunk === "string") return chunk;
  return String(chunk);
}

interface CaptureContext {
  send: (message: RpcStream) => void;
  id: string | number;
  restoreStdout: typeof process.stdout.write;
  restoreStderr: typeof process.stderr.write;
}

let activeCapture: CaptureContext | undefined;

function installCapture(
  send: (message: RpcStream) => void,
  id: string | number,
): void {
  if (activeCapture) throw new Error("output capture is already active");

  const restoreStdout = process.stdout.write.bind(process.stdout);
  const restoreStderr = process.stderr.write.bind(process.stderr);

  activeCapture = { send, id, restoreStdout, restoreStderr };

  process.stdout.write = (
    chunk: unknown,
    encoding?: unknown,
    cb?: unknown,
  ): boolean => {
    send({ id, type: "stdout", data: chunkToString(chunk, encoding) });
    if (typeof cb === "function") (cb as () => void)();
    return true;
  };

  process.stderr.write = (
    chunk: unknown,
    encoding?: unknown,
    cb?: unknown,
  ): boolean => {
    send({ id, type: "stderr", data: chunkToString(chunk, encoding) });
    if (typeof cb === "function") (cb as () => void)();
    return true;
  };
}

function restoreCapture(): void {
  if (!activeCapture) return;
  process.stdout.write = activeCapture.restoreStdout;
  process.stderr.write = activeCapture.restoreStderr;
  activeCapture = undefined;
}

export interface DaemonServerOptions {
  socketPath: string;
  pidfile?: string;
  daemonVersion?: string;
  idleTimeoutMs?: number;
  /** Shared secret required on every RPC; must be provided by the spawner. */
  authToken: string;
  onLog?: (message: string) => void;
}

interface RunParams {
  session?: string;
  command: string;
  positionals?: string[];
  flags?: Record<string, string | boolean | undefined>;
  cwd?: string;
  idleTimeoutMs?: number;
  env?: Record<string, string | undefined | null>;
}

export class DaemonServer {
  private server?: Server;
  private registry: SessionRegistry<BrowserSession>;
  private runQueue: Promise<unknown> = Promise.resolve();
  private sockets = new Set<Socket>();
  private shuttingDown = false;
  private readonly socketPath: string;
  private readonly pidfile?: string;
  private readonly daemonVersion: string;
  private readonly idleTimeoutMs: number;
  private readonly authToken: string;
  private readonly onLog?: (message: string) => void;

  constructor(options: DaemonServerOptions) {
    this.socketPath = options.socketPath;
    this.pidfile = options.pidfile;
    this.daemonVersion = options.daemonVersion ?? "0.0.0";
    this.idleTimeoutMs = options.idleTimeoutMs ?? 900_000;
    this.authToken = options.authToken;
    this.onLog = options.onLog;
    this.registry = new SessionRegistry({
      idleTimeoutMs: this.idleTimeoutMs,
      onIdleTimeout: () => {
        this.log("idle timeout reached; shutting down");
        void this.stop().then(
          () => process.exit(0),
          () => process.exit(1),
        );
      },
    });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Set a restrictive umask before creating the Unix socket so it is born
      // owner-only (mode 0o600), then restore it once listening.
      const isNamedPipe = this.socketPath.startsWith("\\\\.\\pipe\\");
      const oldUmask = isNamedPipe ? 0 : process.umask(0o077);
      this.server = createServer((socket) => this.handleConnection(socket));
      this.server.on("error", (err) => {
        if (!isNamedPipe) process.umask(oldUmask);
        reject(err);
      });
      // Explicit `readableAll`/`writableAll: false` tells Node to use a
      // creator-only DACL on the Windows named pipe; Unix IPC ignores these keys.
      this.server.listen(
        { path: this.socketPath, readableAll: false, writableAll: false },
        async () => {
          try {
            // Defense in depth: explicitly chmod the socket to owner-only. On
            // Windows named pipes are not filesystem paths and cannot be chmod'd.
            if (!isNamedPipe) {
              chmodSync(this.socketPath, 0o600);
            }
            await this.writePidfile();
            this.log(`daemon listening on ${this.socketPath}`);
            resolve();
          } catch (err) {
            reject(err);
          } finally {
            if (!isNamedPipe) process.umask(oldUmask);
          }
        },
      );
    });
  }

  async stop(): Promise<void> {
    // A SIGTERM can arrive while a `quit` RPC or the idle timeout is already
    // stopping the daemon; run the teardown once and let every caller await it.
    this.stopPromise ??= this.doStop();
    return this.stopPromise;
  }

  private stopPromise?: Promise<void>;

  private async doStop(): Promise<void> {
    this.shuttingDown = true;
    this.registry.shutdown();
    this.log("stopping daemon");
    // Stop accepting new connections before tearing down sessions so a client
    // that connects during shutdown gets a retryable error instead of racing
    // registry shutdown. Destroy the tracked sockets immediately so the server
    // close event does not depend on well-behaved peers closing their end.
    const serverClosed = new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        this.log("server close did not finish in 5s; forcing shutdown");
        resolve();
      }, 5_000);
      this.server.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      this.server.close();
    });
    for (const socket of this.sockets) {
      socket.destroy();
    }
    await serverClosed;
    // Tear down the browser before removing our bookkeeping, so a hung
    // `BrowserSession.close()` leaves the pidfile in place as the recovery
    // breadcrumb: `session list` still reports the process and `session stop`
    // can signal it, instead of an orphaned Chromium only the OS process table
    // knows about. The wait is bounded so shutdown always completes; the
    // process exit that follows lets Playwright's exit handlers kill the
    // browser child. A replacement daemon starting concurrently is not blocked
    // by the surviving files: it stops us via the pidfile and cleans up, and
    // `removeOwnSessionFiles` only deletes files our own pidfile still owns.
    const browserClosed = await this.stopAllBounded(10_000);
    if (browserClosed) {
      await this.removeOwnSessionFiles();
    } else {
      this.log(
        "browser teardown did not finish in 10s; keeping session files so `session stop` can recover",
      );
    }
  }

  /** Race `registry.stopAll()` against a timeout; true when it finished. */
  private async stopAllBounded(timeoutMs: number): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.registry.stopAll().then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async removeOwnSessionFiles(): Promise<void> {
    if (!this.pidfile) return;
    const sessionDir = dirname(this.pidfile);

    // A concurrent `ensureDaemonClient` replacement may be starting.  Take
    // the same `.lock` used for startup; if a live process holds it, skip
    // cleanup and let that process own the session directory.
    const release = await this.claimCleanupLock(sessionDir);
    if (!release) return;
    try {
      // Snapshot ownership once while the lock protects us from replacement
      // daemons; re-reading after we delete the pidfile would abort cleanup.
      const ours = await this.ownsPidfile();
      if (!ours) return;

      if (!this.isNamedPipePath(this.socketPath)) {
        await rm(this.socketPath, { force: true }).catch(() => 0);
      }
      await rm(this.pidfile, { force: true }).catch(() => 0);

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

  private async ownsPidfile(): Promise<boolean> {
    if (!this.pidfile) return false;
    try {
      const raw = await readFile(this.pidfile, "utf8");
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

  private async claimCleanupLock(
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
          if (await this.isStaleLock(lockPath)) {
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

  private async isStaleLock(lockPath: string): Promise<boolean> {
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

  private isNamedPipePath(path: string): boolean {
    return path.startsWith("\\\\.\\pipe\\");
  }

  get sessionCount(): number {
    return this.registry.list().length;
  }

  private handleConnection(socket: Socket): void {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    let buffer = "";
    socket.on("data", (data) => {
      buffer += data.toString("utf8");
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        this.handleLine(line, socket).catch((err: unknown) => {
          this.log(`handler error: ${String(err)}`);
          socket.end();
        });
      }
    });
    socket.on("error", (err) => {
      this.log(`socket error: ${err.message}`);
    });
  }

  private async handleLine(line: string, socket: Socket): Promise<void> {
    const send = (message: RpcMessage): void => {
      if (socket.destroyed) return;
      socket.write(encodeRpc(message));
    };

    let request: RpcRequest;
    try {
      request = decodeRpc(line) as RpcRequest;
    } catch {
      send({
        id: 0,
        type: "error",
        error: { code: "EPARSE", message: "malformed JSON request" },
      });
      return;
    }

    if (!constantTimeEquals(request.authToken ?? "", this.authToken)) {
      send({
        id: request.id ?? 0,
        type: "error",
        error: { code: "EAUTH", message: "invalid or missing auth token" },
      });
      socket.end();
      return;
    }

    try {
      await this.handleRequest(request, send, socket);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errHint =
        err instanceof Error ? (err as { hint?: unknown }).hint : undefined;
      const hint = typeof errHint === "string" ? errHint : undefined;
      const exitCode =
        err instanceof CliError ? (err.exitCode ?? EXIT.ERROR) : EXIT.ERROR;
      const code =
        err instanceof DaemonShutdownError ? "ESHUTDOWN" : "ECOMMAND";
      send({
        id: request.id,
        type: "error",
        error: { code, message, hint, exitCode },
      });
    }
  }

  private async handleRequest(
    request: RpcRequest,
    send: (message: RpcMessage) => void,
    socket: Socket,
  ): Promise<void> {
    const { id, method } = request;

    // Read-only lifecycle probes should remain usable while a graceful stop is
    // in progress; mutating/stopping methods must wait or fail.
    if (
      this.shuttingDown &&
      method !== "version" &&
      method !== "ping" &&
      method !== "list"
    ) {
      throw new DaemonShutdownError();
    }

    switch (method) {
      case "version": {
        send({
          id,
          type: "stdout",
          data: JSON.stringify({
            daemonVersion: this.daemonVersion,
            protocolVersion: DAEMON_PROTOCOL_VERSION,
            sessionCount: this.sessionCount,
            shuttingDown: this.shuttingDown,
          }),
        });
        send({ id, type: "done", exitCode: 0 });
        return;
      }
      case "ping": {
        send({ id, type: "done", exitCode: 0 });
        return;
      }
      case "list": {
        send({
          id,
          type: "stdout",
          data: JSON.stringify(this.registry.list()),
        });
        send({ id, type: "done", exitCode: 0 });
        return;
      }
      case "stop": {
        const params = (request.params ?? {}) as { name?: string };
        if (!params.name) {
          throw new Error("stop requires a session name");
        }
        // Serialize `stop` with the `run` queue so it cannot tear down a
        // session while a `run` request is still inside `registry.run` awaiting
        // its turn on the holder queue.
        const sessionName = params.name;
        const enqueued = this.enqueueRun(async () => {
          const stopped = await this.registry.stop(sessionName);
          if (!stopped) throw new Error(`session "${sessionName}" not found`);
        });
        this.runQueue = enqueued.catch(() => 0);
        await enqueued;
        send({ id, type: "done", exitCode: 0 });
        return;
      }
      case "stop-all": {
        // Stop accepting new work immediately and drain any in-flight run before
        // tearing down sessions. This avoids a window where `registry.run()`
        // throws `DaemonShutdownError` (mapped to retryable `ESHUTDOWN`) for
        // the whole duration of the teardown.
        const wasShuttingDown = this.shuttingDown;
        this.shuttingDown = true;
        const enqueued = this.enqueueRun(() => this.stopAll());
        this.runQueue = enqueued.catch(() => 0);
        try {
          await enqueued;
        } finally {
          // Don't undo a daemon shutdown that started while we were draining
          // (e.g. the idle timeout called `registry.shutdown()`).
          this.shuttingDown = this.registry.isShutdown() || wasShuttingDown;
        }
        send({ id, type: "done", exitCode: 0 });
        return;
      }
      case "quit": {
        // Stop accepting new work immediately so a run that arrives while we are
        // draining the queue gets a retryable ESHUTDOWN instead of being killed
        // mid-flight after the socket closes.
        this.shuttingDown = true;
        // Drain any in-flight run before acknowledging quit, so its "done" frame
        // is flushed before the socket is torn down.
        await this.runQueue.catch(() => 0);
        send({ id, type: "done", exitCode: 0 });
        let stopStarted = false;
        const doStop = async (): Promise<void> => {
          if (stopStarted) return;
          stopStarted = true;
          try {
            await this.stop();
            process.exit(0);
          } catch {
            process.exit(1);
          }
        };
        // The client may resolve on "done" and immediately destroy the socket,
        // which can prevent the end-callback from firing. Use a short fallback
        // so the daemon exits even when the peer is gone.
        socket.end(doStop);
        setTimeout(doStop, 1_000);
        return;
      }
      case "run": {
        await this.handleRun(request.params as RunParams, id, send);
        return;
      }
      default:
        throw new Error(`unknown method "${method}"`);
    }
  }

  private async handleRun(
    params: RunParams,
    id: string | number,
    send: (message: RpcMessage) => void,
  ): Promise<void> {
    const {
      session: rawSession,
      command,
      positionals = [],
      flags = {},
      cwd,
      idleTimeoutMs,
      env,
    } = params;
    if (!rawSession) throw new Error("run requires a session name");
    const sessionName = String(rawSession);
    if (!command) throw new Error("run requires a command");

    const runWork = async (): Promise<number> => {
      // The caller-supplied cwd is trusted by design: anyone who can present
      // the per-session token is the same OS user (token file 0600 in a 0700
      // dir) and could run the CLI one-shot from any directory with identical
      // effect. Config/page/output resolution from this cwd mirrors that
      // one-shot run; the registry pins cwd into the session identity so an
      // existing session cannot be retargeted to a different directory.
      const runCwd = cwd ?? process.cwd();
      if (!isAbsolute(runCwd)) {
        throw new CliError(
          `session run cwd must be an absolute path: ${runCwd}`,
        );
      }
      const cwdStat = await stat(runCwd).catch(() => undefined);
      if (!cwdStat?.isDirectory()) {
        throw new CliError(
          `session run cwd is not a directory: ${runCwd}`,
          "the directory may have been removed between the CLI invocation and the daemon run",
        );
      }
      const originalCwd = process.cwd();

      // The daemon re-resolves a11y.config.json, so clear the module-level cache
      // on every run so edits between invocations are picked up.
      clearConfigCache();

      // The file:// allow flag is per-run and per-caller. Reset it here so an
      // earlier run cannot widen the gate, then let the command's target
      // resolution helpers set it based on the current targets.
      delete process.env.REAL_A11Y_MCP_ALLOW_FILE;
      const restoreEnv = withEnvSnapshot(env);
      try {
        // Capture stdout/stderr for the whole run, including session creation,
        // so `--verbose` diagnostics (e.g. the resolved Chrome binary) reach the
        // CLI just like they do in the one-shot path. `enqueueRun` serializes
        // requests, so only one capture is ever active at a time.
        installCapture(send, id);
        try {
          process.chdir(runCwd);
          try {
            const targets = resolveCommandTargets(command, positionals, flags);
            const sessionFlagsValue = {
              ...sessionFlags(flags, targets),
              cwd: runCwd,
            };
            // Origin pinning is enforced per-run inside `BrowserSession.open`, so
            // the browser context must not be built with a session-wide allowlist.
            const createFlags: SessionFlags = { ...sessionFlagsValue };
            delete createFlags.allowedOrigins;
            return await this.registry.run(
              sessionName,
              sessionFlagsValue,
              this.resolveIdleTimeout(idleTimeoutMs),
              async () => createSession(createFlags),
              async (session) =>
                runCommandOnSession(
                  session as import("@real-a11y-dev/browser").BrowserSession,
                  command,
                  positionals,
                  flags,
                ),
            );
          } finally {
            process.chdir(originalCwd);
          }
        } finally {
          restoreCapture();
        }
      } finally {
        restoreEnv();
      }
    };

    const enqueued = this.enqueueRun(runWork);
    this.runQueue = enqueued.catch(() => 0);
    const exitCode = await enqueued;
    send({ id, type: "done", exitCode });
  }

  private enqueueRun<T>(work: () => Promise<T>): Promise<T> {
    const next = this.runQueue.then(work);
    return next;
  }

  private async stopAll(): Promise<void> {
    await this.registry.stopAll();
  }

  private async writePidfile(): Promise<void> {
    if (!this.pidfile) return;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      this.pidfile,
      JSON.stringify({
        pid: process.pid,
        startedAt: Date.now(),
        daemonVersion: this.daemonVersion,
        protocolVersion: DAEMON_PROTOCOL_VERSION,
      }),
      { encoding: "utf8", mode: 0o600 },
    );
  }

  private resolveIdleTimeout(requested: unknown): number {
    const n = Number(requested);
    if (!Number.isFinite(n) || n <= 0) {
      // Invalid, missing, or zero values fall back to the daemon's configured
      // default. `0` is not an opt-out because the CLI docs describe the
      // timeout as capped at one hour.
      return this.idleTimeoutMs;
    }
    // Bound positive per-request values between a sensible minimum (so the
    // timer doesn't race the first run) and one hour.
    return Math.min(Math.max(n, 1_000), 3_600_000);
  }

  private log(message: string): void {
    if (this.onLog) this.onLog(message);
  }
}
