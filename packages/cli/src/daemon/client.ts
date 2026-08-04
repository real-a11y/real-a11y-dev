/**
 * Daemon client used by tests and, in PR B, by the CLI's `--session` router.
 *
 * Connects to the daemon's Unix socket / named pipe, sends one NDJSON request,
 * and returns the aggregated stdout/stderr plus final exit code.
 */

import { spawn } from "node:child_process";
import { createConnection } from "node:net";

import type { FlagValues } from "../args.js";

import {
  type RpcRequest,
  type RpcResponse,
  encodeRpc,
  decodeRpc,
} from "./protocol.js";

export interface DaemonRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DaemonClientOptions {
  socketPath: string;
}

export class DaemonClient {
  private socketPath: string;

  constructor(options: DaemonClientOptions) {
    this.socketPath = options.socketPath;
  }

  async run(
    session: string,
    command: string,
    positionals: string[],
    flags: FlagValues,
  ): Promise<DaemonRunResult> {
    return this.request({
      id: generateId(),
      method: "run",
      params: { session, command, positionals, flags },
    });
  }

  async version(): Promise<{
    daemonVersion: string;
    protocolVersion: string;
    sessionCount: number;
  }> {
    const { stdout } = await this.request({
      id: generateId(),
      method: "version",
      params: {},
    });
    return JSON.parse(stdout || "{}") as {
      daemonVersion: string;
      protocolVersion: string;
      sessionCount: number;
    };
  }

  async list(): Promise<
    {
      name: string;
      url?: string;
      createdAt: number;
      lastUsedAt: number;
      busy: boolean;
    }[]
  > {
    const { stdout } = await this.request({
      id: generateId(),
      method: "list",
      params: {},
    });
    return JSON.parse(stdout || "[]") as {
      name: string;
      url?: string;
      createdAt: number;
      lastUsedAt: number;
      busy: boolean;
    }[];
  }

  async stop(name: string): Promise<void> {
    await this.request({ id: generateId(), method: "stop", params: { name } });
  }

  async stopAll(): Promise<void> {
    await this.request({ id: generateId(), method: "stop-all", params: {} });
  }

  private request(message: RpcRequest): Promise<DaemonRunResult> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      const stdout: string[] = [];
      const stderr: string[] = [];
      let buffer = "";

      socket.on("connect", () => {
        socket.write(encodeRpc(message));
      });

      socket.on("data", (data) => {
        buffer += data.toString("utf8");
        let index: number;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line) continue;
          let response: RpcResponse;
          try {
            response = decodeRpc(line) as RpcResponse;
          } catch {
            continue;
          }
          switch (response.type) {
            case "stdout":
              stdout.push(response.data);
              break;
            case "stderr":
            case "progress":
              stderr.push(response.data);
              break;
            case "done":
              socket.end();
              resolve({
                exitCode: response.exitCode,
                stdout: stdout.join(""),
                stderr: stderr.join(""),
              });
              return;
            case "error":
              socket.end();
              reject(
                new Error(
                  response.error.hint
                    ? `${response.error.message} (${response.error.hint})`
                    : response.error.message,
                ),
              );
              return;
          }
        }
      });

      socket.on("error", reject);
      socket.on("close", () => {
        reject(new Error("connection closed before response"));
      });
    });
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function spawnDaemon(
  socketPath: string,
  pidfile: string,
  idleTimeoutMs = 0,
  daemonPath?: string,
): Promise<() => Promise<void>> {
  const script = daemonPath ?? new URL("./entry.js", import.meta.url).pathname;
  const child = spawn(
    process.execPath,
    [
      script,
      "--socket",
      socketPath,
      "--pidfile",
      pidfile,
      "--idle-timeout-ms",
      String(idleTimeoutMs),
    ],
    { detached: true, stdio: "pipe" },
  );

  let _stderr = "";
  child.stderr?.on("data", (chunk) => {
    _stderr += chunk.toString();
  });

  await waitForSocket(socketPath, 10_000);

  return async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.on("close", resolve));
  };
}

function waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = (): void => {
      const socket = createConnection(socketPath);
      socket.on("connect", () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        if (Date.now() > deadline) {
          reject(
            new Error(`daemon socket did not appear within ${timeoutMs}ms`),
          );
        } else {
          setTimeout(attempt, 50);
        }
      });
    };
    attempt();
  });
}
