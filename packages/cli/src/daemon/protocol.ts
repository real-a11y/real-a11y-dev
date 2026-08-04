/**
 * NDJSON RPC wire format for the session daemon.
 *
 * Every message is a single JSON object terminated by a newline.  A request
 * gets one or more response lines: zero or more `stdout`/`stderr`/`progress`
 * streams followed by exactly one `done` or `error`.
 */

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
