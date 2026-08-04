/**
 * Daemon client used by tests and, in PR B, by the CLI's `--session` router.
 *
 * Connects to the daemon's Unix socket / named pipe, sends one NDJSON request,
 * and returns the aggregated stdout/stderr plus final exit code.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";

import type { FlagValues } from "../args.js";
import { CliError, EXIT } from "../exit.js";
import { CLI_VERSION } from "../version.js";

import {
  type RpcRequest,
  type RpcResponse,
  encodeRpc,
  decodeRpc,
} from "./protocol.js";
import { tightenWindowsTokenAcl } from "./windows-acl.js";

export interface DaemonRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Errors thrown by the transport layer (connection refused, socket closed
 * before any data was sent, etc.). These can be retried; errors from the
 * daemon running a command are plain `CliError`s and must not be retried.
 */
export class DaemonTransportError extends CliError {
  constructor(message: string) {
    super(message, undefined, EXIT.ERROR);
  }
}

export class DaemonTimeoutError extends DaemonTransportError {
  constructor(message: string) {
    super(message);
  }
}

export interface DaemonClientOptions {
  socketPath: string;
  /** Auth token to send with every request. */
  authToken?: string;
  /** Path to a file containing the auth token; read before each request. */
  tokenFile?: string;
}

export class DaemonClient {
  private socketPath: string;
  private authToken?: string;
  private tokenFile?: string;

  constructor(options: DaemonClientOptions) {
    this.socketPath = options.socketPath;
    this.authToken = options.authToken;
    this.tokenFile = options.tokenFile;
  }

  async run(
    session: string,
    command: string,
    positionals: string[],
    flags: FlagValues,
    cwd?: string,
    idleTimeoutMs?: number,
    env?: Record<string, string | undefined | null>,
  ): Promise<DaemonRunResult> {
    // `run` may mutate the page, so a connection that closes after the request
    // was dispatched cannot be safely retried. `request` will surface that as a
    // non-retryable `CliError` instead of a `DaemonTransportError`.
    return this.request(
      {
        id: generateId(),
        method: "run",
        params: {
          session,
          command,
          positionals,
          flags,
          cwd,
          idleTimeoutMs,
          env,
        },
      },
      undefined,
      { retryIfClosed: false },
    );
  }

  async version(): Promise<{
    daemonVersion: string;
    protocolVersion: string;
    sessionCount: number;
    shuttingDown?: boolean;
  }> {
    const { stdout } = await this.request(
      {
        id: generateId(),
        method: "version",
        params: {},
      },
      15_000,
    );
    return JSON.parse(stdout || "{}") as {
      daemonVersion: string;
      protocolVersion: string;
      sessionCount: number;
      shuttingDown?: boolean;
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
    const { stdout } = await this.request(
      {
        id: generateId(),
        method: "list",
        params: {},
      },
      10_000,
    );
    return JSON.parse(stdout || "[]") as {
      name: string;
      url?: string;
      createdAt: number;
      lastUsedAt: number;
      busy: boolean;
    }[];
  }

  async stop(name: string): Promise<void> {
    await this.request(
      { id: generateId(), method: "stop", params: { name } },
      15_000,
    );
  }

  async stopAll(): Promise<void> {
    await this.request(
      { id: generateId(), method: "stop-all", params: {} },
      15_000,
    );
  }

  async quit(): Promise<void> {
    // quit drains the in-flight run queue and then closes the browser, which can
    // take longer than a typical RPC. Give it a generous timeout.
    await this.request(
      { id: generateId(), method: "quit", params: {} },
      60_000,
    );
  }

  private async request(
    message: RpcRequest,
    timeoutMs?: number,
    options: { retryIfClosed?: boolean } = {},
  ): Promise<DaemonRunResult> {
    const { retryIfClosed = true } = options;
    let authToken = this.authToken;
    if (authToken === undefined && this.tokenFile) {
      authToken = await readFile(this.tokenFile, "utf8")
        .then((s) => s.trim())
        .catch(() => undefined);
    }
    const payload = { ...message, authToken };
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      const stdout: string[] = [];
      const stderr: string[] = [];
      let buffer = "";
      let connected = false;

      const clear = () => {
        if (timer) clearTimeout(timer);
      };
      const timer =
        timeoutMs !== undefined && timeoutMs > 0
          ? setTimeout(() => {
              socket.destroy();
              reject(
                new DaemonTimeoutError(
                  `daemon RPC request timed out after ${timeoutMs}ms`,
                ),
              );
            }, timeoutMs)
          : undefined;

      socket.on("connect", () => {
        connected = true;
        socket.write(encodeRpc(payload));
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
              clear();
              resolve({
                exitCode: response.exitCode,
                stdout: stdout.join(""),
                stderr: stderr.join(""),
              });
              socket.destroy();
              return;
            case "error":
              clear();
              if (response.error.code === "ESHUTDOWN") {
                reject(new DaemonTransportError(response.error.message));
              } else {
                reject(
                  new CliError(
                    response.error.message,
                    response.error.hint,
                    response.error.exitCode,
                  ),
                );
              }
              socket.destroy();
              return;
          }
        }
      });

      socket.on("error", (err) => {
        clear();
        if (!connected) {
          reject(
            new DaemonTransportError(
              `daemon connection failed: ${err.message}`,
            ),
          );
          return;
        }
        if (!retryIfClosed) {
          reject(
            new CliError(
              "daemon connection lost during request; the command may already have run",
              "run 'real-a11y session list' to check",
              EXIT.ERROR,
            ),
          );
          return;
        }
        reject(
          new DaemonTransportError(`daemon connection lost: ${err.message}`),
        );
      });
      socket.on("close", () => {
        clear();
        if (!connected) {
          reject(
            new DaemonTransportError(
              "daemon connection closed before response",
            ),
          );
          return;
        }
        if (!retryIfClosed) {
          reject(
            new CliError(
              "daemon connection closed during request; the command may already have run",
              "run 'real-a11y session list' to check",
              EXIT.ERROR,
            ),
          );
          return;
        }
        reject(
          new DaemonTransportError(
            "daemon connection closed before response completed",
          ),
        );
      });
    });
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isSocketListening(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(false);
    }, 1_000);
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

export async function spawnDaemon(
  socketPath: string,
  pidfile: string,
  idleTimeoutMs = 900_000,
  daemonPath?: string,
  tokenFile?: string,
): Promise<{ stop: () => Promise<void>; tokenFile: string }> {
  const resolvedTokenFile = tokenFile ?? join(dirname(socketPath), "token");
  const sessionDir = dirname(resolvedTokenFile);
  await mkdir(sessionDir, { recursive: true, mode: 0o700 });
  // Verify ownership on POSIX so a symlink or pre-existing directory owned by
  // another user cannot trick us into exposing or overwriting a token.
  if (process.getuid) {
    const dirStat = await stat(sessionDir).catch(() => undefined);
    if (dirStat && dirStat.uid !== process.getuid()) {
      throw new CliError(
        `session directory ${sessionDir} is owned by uid ${dirStat.uid}, not ${process.getuid()}`,
        "check that you own the directory",
      );
    }
  }
  // Tighten the directory permissions before writing the token. If we can't
  // secure the directory, fail loudly rather than leave the secret in a
  // world-readable path.
  try {
    await chmod(sessionDir, 0o700);
  } catch (err) {
    throw new CliError(
      `could not secure session directory ${sessionDir}: ${err instanceof Error ? err.message : String(err)}`,
      "check that you own the directory",
    );
  }

  // Refuse to overwrite an existing token for a live daemon. If the socket is
  // still listening, the caller must stop it first; otherwise the stale token
  // is from a crashed daemon and can be rotated.
  const tokenExists = await stat(resolvedTokenFile)
    .then(() => true)
    .catch(() => false);
  if (tokenExists && (await isSocketListening(socketPath))) {
    throw new CliError(
      `a daemon is already listening on ${socketPath}; stop it before spawning`,
    );
  }

  const authToken = randomBytes(32).toString("hex");
  // If a symlinked token is left behind, deleting it only removes the link and
  // the following writeFile creates a fresh file owned by this user.
  const tokenLink = await lstat(resolvedTokenFile).catch(() => undefined);
  if (tokenLink?.isSymbolicLink()) {
    await rm(resolvedTokenFile, { force: true });
  } else if (process.getuid && tokenLink) {
    const tokenStat = await stat(resolvedTokenFile).catch(() => undefined);
    if (tokenStat && tokenStat.uid !== process.getuid()) {
      throw new CliError(
        `token file ${resolvedTokenFile} is owned by uid ${tokenStat.uid}, not ${process.getuid()}`,
        "stop the existing daemon and clear the session directory",
      );
    }
  }
  // Remove the old token so writeFile creates a new file with the requested
  // mode, and fail loudly if the permissions cannot be restricted afterwards.
  await rm(resolvedTokenFile, { force: true });
  await writeFile(resolvedTokenFile, authToken, { mode: 0o600 });
  await chmod(resolvedTokenFile, 0o600);
  // `chmod` is a no-op on Windows; apply the same explicit token-file ACL the
  // production spawn path uses so the helper never leaves a looser token.
  await tightenWindowsTokenAcl(resolvedTokenFile);

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
      "--daemon-version",
      CLI_VERSION,
      "--token-file",
      resolvedTokenFile,
    ],
    {
      detached: true,
      stdio: "pipe",
    },
  );

  let _stderr = "";
  child.stderr?.on("data", (chunk) => {
    _stderr += chunk.toString();
  });

  await waitForSocket(socketPath, 10_000);

  return {
    tokenFile: resolvedTokenFile,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => child.on("close", resolve));
    },
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
