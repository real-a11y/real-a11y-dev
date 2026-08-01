#!/usr/bin/env node
/**
 * Session daemon entrypoint.
 *
 * Spawned by the CLI client on first `--session` use.  It owns the socket,
 * writes its pidfile, and keeps sessions warm until the idle timeout fires or
 * a `stop-all` request arrives.
 */

import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

import { DaemonServer } from "./server.js";

function log(message: string, logFile?: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  if (logFile) {
    try {
      appendFileSync(logFile, line, { flag: "a" });
    } catch {
      // If logging fails, still try stderr.
    }
  }
  process.stderr.write(line);
}

function prepareSocket(socketPath: string): void {
  const dir = dirname(socketPath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    rmSync(socketPath, { force: true });
  } catch {
    // ignore
  }
}

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      socket: { type: "string" },
      pidfile: { type: "string" },
      "idle-timeout-ms": { type: "string" },
      "log-file": { type: "string" },
      "daemon-version": { type: "string" },
    },
    allowPositionals: false,
  });

  const socketPath = values.socket;
  if (!socketPath) {
    process.stderr.write("daemon: --socket is required\n");
    process.exit(2);
  }

  const idleTimeoutMs = Number(values["idle-timeout-ms"] ?? 900_000);
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs < 0) {
    process.stderr.write(
      "daemon: --idle-timeout-ms must be a non-negative number\n",
    );
    process.exit(2);
  }

  prepareSocket(socketPath);

  const server = new DaemonServer({
    socketPath,
    pidfile: values.pidfile,
    daemonVersion: values["daemon-version"],
    idleTimeoutMs,
    onLog: (message) => log(message, values["log-file"]),
  });

  const shutdown = async (signal: string): Promise<void> => {
    log(`caught ${signal}, shutting down`, values["log-file"]);
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  server.start().catch((err: unknown) => {
    log(`failed to start: ${String(err)}`, values["log-file"]);
    process.exit(2);
  });
}

main();
