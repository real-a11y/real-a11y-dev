/**
 * NDJSON RPC wire format for the session daemon.
 *
 * Every message is a single JSON object terminated by a newline.  A request
 * gets one or more response lines: zero or more `stdout`/`stderr`/`progress`
 * streams followed by exactly one `done` or `error`.
 */

import { StringDecoder } from "node:string_decoder";

export const DAEMON_PROTOCOL_VERSION = "2";

export interface RpcRequest {
  id: string | number;
  method: string;
  params: unknown;
  authToken?: string;
}

export interface RpcStream {
  id: string | number;
  type: "stdout" | "stderr" | "progress";
  data: string;
}

export interface RpcDone {
  id: string | number;
  type: "done";
  exitCode: number;
}

export interface RpcError {
  id: string | number;
  type: "error";
  error: {
    code: string;
    message: string;
    hint?: string;
    /** Process exit code to surface when the CLI is driving the daemon. */
    exitCode?: number;
  };
}

export type RpcMessage = RpcRequest | RpcStream | RpcDone | RpcError;
export type RpcResponse = RpcStream | RpcDone | RpcError;

export function encodeRpc(message: RpcMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export function decodeRpc(line: string): RpcMessage {
  return JSON.parse(line) as RpcMessage;
}

/**
 * Reassemble newline-terminated lines from a socket's `data` chunks. Call the
 * returned function with each chunk and iterate the complete, trimmed,
 * non-empty lines it yields; a trailing partial line stays buffered for the
 * next chunk.
 *
 * @internal
 */
export function createLineReader(): (
  chunk: Buffer | string,
) => Generator<string> {
  let buffer = "";
  // One decoder for the whole stream: a multibyte character split across two
  // socket reads is held until its last byte arrives, where decoding each
  // chunk alone would turn its halves into U+FFFD.
  const decoder = new StringDecoder("utf8");
  return function* (chunk) {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      yield line;
    }
  };
}
