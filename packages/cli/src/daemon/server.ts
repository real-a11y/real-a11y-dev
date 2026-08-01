/**
 * NDJSON RPC server for the session daemon.
 *
 * Listens on a Unix domain socket (or, on Windows, a named pipe) and dispatches
 * `run` requests against named sessions held by the {@link SessionRegistry}.
 *
 * Output capture is intentionally simple for PR A: commands write to the global
 * `process.stdout`/`stderr` streams, so the server serialises all `run` calls
 * and temporarily redirects those streams into per-request RPC messages.  PR C
 * will move this to a proper per-command output sink.
 */

import { chmod, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";

import type { BrowserSession } from "@real-a11y-dev/browser";

import { sessionFlags } from "../commands/common.js";
import { createSession } from "../session.js";

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
  onLog?: (message: string) => void;
}

interface RunParams {
  session?: string;
  command: string;
  positionals?: string[];
  flags?: Record<string, string | boolean | undefined>;
  seeded?: string[];
}

export class DaemonServer {
  private server?: Server;
  private registry: SessionRegistry<BrowserSession>;
  private runQueue: Promise<unknown> = Promise.resolve();
  private sockets = new Set<Socket>();
  private readonly socketPath: string;
  private readonly pidfile?: string;
  private readonly daemonVersion: string;
  private readonly onLog?: (message: string) => void;

  constructor(options: DaemonServerOptions) {
    this.socketPath = options.socketPath;
    this.pidfile = options.pidfile;
    this.daemonVersion = options.daemonVersion ?? "0.0.0";
    this.onLog = options.onLog;
    this.registry = new SessionRegistry({
      idleTimeoutMs: options.idleTimeoutMs,
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
      this.server = createServer((socket) => this.handleConnection(socket));
      this.server.on("error", reject);
      this.server.listen(this.socketPath, async () => {
        try {
          // Lock the socket to the daemon owner on Unix. Named pipes on Windows
          // are not filesystem paths and cannot be chmod'd.
          if (!this.socketPath.startsWith("\\\\.\\pipe\\")) {
            await chmod(this.socketPath, 0o600);
          }
          await this.writePidfile();
          this.log(`daemon listening on ${this.socketPath}`);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  async stop(): Promise<void> {
    this.log("stopping daemon");
    await this.registry.stopAll();
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      for (const socket of this.sockets) {
        socket.destroy();
      }
      this.server.close(async () => {
        try {
          await rm(this.socketPath, { force: true });
        } catch {
          // already removed or unavailable
        }
        try {
          if (this.pidfile) await rm(this.pidfile, { force: true });
        } catch {
          // already removed or unavailable
        }
        resolve();
      });
    });
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

    try {
      await this.handleRequest(request, send);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errHint =
        err instanceof Error ? (err as { hint?: unknown }).hint : undefined;
      const hint = typeof errHint === "string" ? errHint : undefined;
      send({
        id: request.id,
        type: "error",
        error: { code: "ECOMMAND", message, hint },
      });
    }
  }

  private async handleRequest(
    request: RpcRequest,
    send: (message: RpcMessage) => void,
  ): Promise<void> {
    const { id, method } = request;

    switch (method) {
      case "version": {
        send({
          id,
          type: "stdout",
          data: JSON.stringify({
            daemonVersion: this.daemonVersion,
            protocolVersion: DAEMON_PROTOCOL_VERSION,
            sessionCount: this.sessionCount,
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
        const stopped = await this.registry.stop(params.name);
        if (!stopped) throw new Error(`session "${params.name}" not found`);
        send({ id, type: "done", exitCode: 0 });
        return;
      }
      case "stop-all": {
        await this.stopAll();
        send({ id, type: "done", exitCode: 0 });
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
    } = params;
    if (!rawSession) throw new Error("run requires a session name");
    const sessionName = String(rawSession);
    if (!command) throw new Error("run requires a command");

    const targets = resolveCommandTargets(command, positionals, flags);
    const sessionFlagsValue = sessionFlags(flags, targets);

    const runWork = async (): Promise<number> => {
      return this.registry.run(
        sessionName,
        async () => createSession(sessionFlagsValue),
        async (session) => {
          installCapture(send, id);
          try {
            return await runCommandOnSession(
              session as import("@real-a11y-dev/browser").BrowserSession,
              command,
              positionals,
              flags,
            );
          } finally {
            restoreCapture();
          }
        },
      );
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
        daemonVersion: this.daemonVersion,
        protocolVersion: DAEMON_PROTOCOL_VERSION,
      }),
      { encoding: "utf8", mode: 0o600 },
    );
  }

  private log(message: string): void {
    if (this.onLog) this.onLog(message);
  }
}
