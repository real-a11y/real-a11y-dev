import { describe, expect, it } from "vitest";

import {
  DAEMON_PROTOCOL_VERSION,
  decodeRpc,
  encodeRpc,
  type RpcDone,
  type RpcRequest,
} from "./protocol.js";

describe("daemon protocol", () => {
  it("encodes a message as NDJSON", () => {
    const request: RpcRequest = { id: 1, method: "ping", params: {} };
    expect(encodeRpc(request)).toBe('{"id":1,"method":"ping","params":{}}\n');
  });

  it("round-trips a message", () => {
    const original: RpcDone = {
      id: "abc",
      type: "done",
      exitCode: 0,
    };
    expect(decodeRpc(encodeRpc(original).trim())).toEqual(original);
  });

  it("exposes a protocol version", () => {
    expect(DAEMON_PROTOCOL_VERSION).toMatch(/^\d+$/);
  });
});
