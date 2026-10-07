import { describe, expect, it } from "vitest";

import {
  graftNativeFrame,
  isNativeIframeRole,
  nativeFrameSuffix,
  nativeNodeId,
  splitNativeNodeId,
  withNativeIdSuffix,
  type NativeGraftNode,
} from "./frames.js";

describe("native frame node ids", () => {
  it("builds and splits a node id, with or without a frame and its document", () => {
    expect(nativeNodeId(8)).toBe("ax-dom-8");
    expect(nativeNodeId(8, { frameId: "F1" })).toBe("ax-dom-8@F1");
    expect(nativeNodeId(8, { frameId: "F1", documentId: "D1" })).toBe(
      "ax-dom-8@F1.D1",
    );
    for (const frame of [
      null,
      { frameId: "F1" },
      { frameId: "F1", documentId: "D1" },
    ]) {
      expect(splitNativeNodeId(nativeNodeId(8, frame))).toEqual({
        localId: "ax-dom-8",
        frame,
      });
    }
    expect(nativeFrameSuffix(null)).toBe("");
  });

  it("knows Chromium's iframe roles", () => {
    expect(isNativeIframeRole("Iframe")).toBe(true);
    expect(isNativeIframeRole("IframePresentational")).toBe(true);
    expect(isNativeIframeRole("region")).toBe(false);
  });
});

describe("graftNativeFrame", () => {
  const n = (
    id: string,
    depth: number,
    childIds: string[] = [],
  ): NativeGraftNode => ({ id, depth, childIds });

  it("puts a frame's nodes under its row, one level deeper, in order", () => {
    const nodes = [
      n("root", 0, ["frame", "after"]),
      n("frame", 1),
      n("after", 1),
    ];
    const frame = [n("doc", 0, ["btn"]), n("btn", 1)].map((x) =>
      withNativeIdSuffix(x, "@F1"),
    );
    expect(graftNativeFrame(nodes, "frame", frame)).toBe(true);
    expect(nodes.map((x) => [x.id, x.depth])).toEqual([
      ["root", 0],
      ["frame", 1],
      ["doc@F1", 2],
      ["btn@F1", 3],
      ["after", 1],
    ]);
    expect(nodes[1]!.childIds).toEqual(["doc@F1"]);
    expect(nodes[2]!.childIds).toEqual(["btn@F1"]);
  });

  it("leaves a row that is missing, already filled, or given nothing", () => {
    const nodes = [n("root", 0, ["frame"]), n("frame", 1, ["x"]), n("x", 2)];
    expect(graftNativeFrame(nodes, "frame", [n("doc", 0)])).toBe(false);
    expect(graftNativeFrame(nodes, "gone", [n("doc", 0)])).toBe(false);
    expect(graftNativeFrame([n("frame", 0)], "frame", [])).toBe(false);
    expect(nodes).toHaveLength(3);
  });
});
