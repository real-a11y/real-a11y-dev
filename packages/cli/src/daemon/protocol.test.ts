import { describe, expect, it } from "vitest";

import {
  createLineReader,
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

describe("createLineReader", () => {
  const buf = (s: string) => Buffer.from(s, "utf8");

  it("yields complete trimmed lines and skips blank ones", () => {
    const read = createLineReader();
    expect([...read(buf('a\n  \n b \r\n\n{"c":1}\n'))]).toEqual([
      "a",
      "b",
      '{"c":1}',
    ]);
  });

  it("buffers a partial line across chunks", () => {
    const read = createLineReader();
    expect([...read(buf("hel"))]).toEqual([]);
    expect([...read(buf("lo\nwor"))]).toEqual(["hello"]);
    expect([...read(buf("ld\n"))]).toEqual(["world"]);
  });

  it("keeps unread lines buffered when the consumer stops early", () => {
    const read = createLineReader();
    for (const line of read(buf("one\ntwo\n"))) {
      expect(line).toBe("one");
      break;
    }
    expect([...read(buf("three\n"))]).toEqual(["two", "three"]);
  });

  it("accepts string chunks as well as Buffers", () => {
    const read = createLineReader();
    expect([...read("hel")]).toEqual([]);
    expect([...read(buf("lo\nwor"))]).toEqual(["hello"]);
    expect([...read("ld\n")]).toEqual(["world"]);
  });
});
