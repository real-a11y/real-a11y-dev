/**
 * Redirects the global stdout/stderr streams into RPC messages for one request.
 */

import type { RpcStream } from "./protocol.js";

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

export function installCapture(
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

export function restoreCapture(): void {
  if (!activeCapture) return;
  process.stdout.write = activeCapture.restoreStdout;
  process.stderr.write = activeCapture.restoreStderr;
  activeCapture = undefined;
}
