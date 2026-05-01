import type { SemanticNode } from "@real-a11y-dev/core";
import { describe, it, expect } from "vitest";

import {
  type FrameInfo,
  type FrameTree,
  buildFrameInfoMap,
  mergeFrameTrees,
} from "./frame-merger.js";

// ---- Fixture helpers ----------------------------------------------------

function makeNode(
  id: string,
  partial: Partial<SemanticNode> & {
    tagName?: string;
    attrs?: Record<string, string>;
  } = {},
): SemanticNode {
  return {
    id,
    parentId: partial.parentId ?? null,
    childIds: partial.childIds ?? [],
    depth: partial.depth ?? 0,
    dom: {
      tagName: partial.tagName ?? "div",
      attributes: partial.attrs ?? {},
      textContent: null,
      descendantText: "",
      isHidden: false,
    },
    a11y: {
      role: "generic",
      name: "",
      description: "",
      states: {},
      properties: {},
      isExposedToAT: true,
    },
    interaction: {
      isInteractive: false,
      actions: [],
      isFocusable: false,
      isEditable: false,
    },
    ui: {
      expanded: false,
      highlighted: false,
      matchesFilter: false,
      selected: false,
    },
  };
}

function makeFrame(
  frameId: number,
  url: string,
  nodes: Array<[string, SemanticNode]>,
  rootId = nodes[0]?.[0] ?? "root",
): FrameTree {
  return { frameId, frameUrl: url, pageTitle: "", nodes, rootId };
}

// ---- Tests --------------------------------------------------------------

describe("mergeFrameTrees", () => {
  it("returns null when no top frame has been announced", () => {
    const result = mergeFrameTrees({
      frames: new Map([
        [5, makeFrame(5, "https://child.test", [["x", makeNode("x")]])],
      ]),
      frameInfoMap: new Map(),
    });
    expect(result).toBeNull();
  });

  it("returns the top frame's nodes unchanged when there are no children", () => {
    const root = makeNode("root", { childIds: ["a"] });
    const a = makeNode("a", { parentId: "root", depth: 1 });
    const top = makeFrame(0, "https://top.test", [
      ["root", root],
      ["a", a],
    ]);

    const result = mergeFrameTrees({
      frames: new Map([[0, top]]),
      frameInfoMap: new Map(),
    });

    expect(result).not.toBeNull();
    expect(result!.nodes.size).toBe(2);
    expect(result!.nodes.get("root")!.childIds).toEqual(["a"]);
    expect(result!.nodeToFrame.get("root")).toBe(0);
    expect(result!.nodeToFrame.get("a")).toBe(0);
  });

  it("attaches a child frame's root under the matching <iframe> via src URL match", () => {
    const iframeNode = makeNode("ifr", {
      tagName: "iframe",
      attrs: { src: "https://child.test/" },
      depth: 1,
    });
    const top = makeFrame(0, "https://top.test", [
      ["root", makeNode("root", { childIds: ["ifr"] })],
      ["ifr", iframeNode],
    ]);

    const child = makeFrame(5, "https://child.test/", [
      ["c-root", makeNode("c-root", { childIds: ["c-1"] })],
      ["c-1", makeNode("c-1", { parentId: "c-root", depth: 1 })],
    ]);

    const result = mergeFrameTrees({
      frames: new Map([
        [0, top],
        [5, child],
      ]),
      frameInfoMap: new Map<number, FrameInfo>([
        [5, { parentFrameId: 0, url: "https://child.test/" }],
      ]),
    });

    expect(result).not.toBeNull();
    // Top-frame ids stay unprefixed.
    expect(result!.nodes.has("ifr")).toBe(true);
    // Child-frame ids get the f<frameId>- prefix.
    expect(result!.nodes.has("f5-c-root")).toBe(true);
    expect(result!.nodes.has("f5-c-1")).toBe(true);
    // Child root is reparented onto the iframe node.
    expect(result!.nodes.get("f5-c-root")!.parentId).toBe("ifr");
    // The iframe gains a child pointer to the new root.
    expect(result!.nodes.get("ifr")!.childIds).toContain("f5-c-root");
    // Depth offsets stack: iframe is depth 1, child root sits at depth 2.
    expect(result!.nodes.get("f5-c-root")!.depth).toBe(2);
    expect(result!.nodes.get("f5-c-1")!.depth).toBe(3);
    // Routing map identifies frame ownership.
    expect(result!.nodeToFrame.get("ifr")).toBe(0);
    expect(result!.nodeToFrame.get("f5-c-root")).toBe(5);
  });

  it("matches relative iframe `src` against the parent frame URL", () => {
    const iframeNode = makeNode("ifr", {
      tagName: "iframe",
      attrs: { src: "/embedded" },
      depth: 0,
    });
    const top = makeFrame(0, "https://app.test/page", [["ifr", iframeNode]]);
    const child = makeFrame(5, "https://app.test/embedded", [
      ["c-root", makeNode("c-root")],
    ]);

    const result = mergeFrameTrees({
      frames: new Map([
        [0, top],
        [5, child],
      ]),
      frameInfoMap: new Map<number, FrameInfo>([
        [5, { parentFrameId: 0, url: "https://app.test/embedded" }],
      ]),
    });

    expect(result!.nodes.get("f5-c-root")!.parentId).toBe("ifr");
  });

  it("does not duplicate the child-root pointer when called twice", () => {
    const iframeNode = makeNode("ifr", {
      tagName: "iframe",
      attrs: { src: "https://child.test/" },
    });
    const top = makeFrame(0, "https://top.test", [["ifr", iframeNode]]);
    const child = makeFrame(5, "https://child.test/", [
      ["c-root", makeNode("c-root")],
    ]);

    const args = {
      frames: new Map([
        [0, top],
        [5, child],
      ]),
      frameInfoMap: new Map<number, FrameInfo>([
        [5, { parentFrameId: 0, url: "https://child.test/" }],
      ]),
    };

    const a = mergeFrameTrees(args);
    const b = mergeFrameTrees(args);

    const childIdsA = a!.nodes
      .get("ifr")!
      .childIds.filter((id) => id === "f5-c-root");
    const childIdsB = b!.nodes
      .get("ifr")!
      .childIds.filter((id) => id === "f5-c-root");
    expect(childIdsA).toHaveLength(1);
    expect(childIdsB).toHaveLength(1);
  });

  it("uses the empty-childIds <iframe> fallback when URL match fails", () => {
    // src is empty (e.g. injected dynamically), so urlsMatch returns false;
    // the fallback should still attach the child to the lone iframe.
    const iframeNode = makeNode("ifr", {
      tagName: "iframe",
      attrs: { src: "" },
    });
    const top = makeFrame(0, "https://top.test", [["ifr", iframeNode]]);
    const child = makeFrame(5, "https://about-blank.test", [
      ["c-root", makeNode("c-root")],
    ]);

    const result = mergeFrameTrees({
      frames: new Map([
        [0, top],
        [5, child],
      ]),
      frameInfoMap: new Map<number, FrameInfo>([
        [5, { parentFrameId: 0, url: "https://about-blank.test" }],
      ]),
    });

    expect(result!.nodes.get("f5-c-root")!.parentId).toBe("ifr");
    expect(result!.nodes.get("ifr")!.childIds).toContain("f5-c-root");
  });

  it("keeps an unattached subframe's nodes in the result with parentId=null on root", () => {
    // Top frame has no <iframe> at all — degenerate case where Chrome
    // reports a subframe but the DOM walker missed it. We still return the
    // child's nodes (so action routing can find them) but the root has no
    // parent in the merged tree.
    const top = makeFrame(0, "https://top.test", [["root", makeNode("root")]]);
    const child = makeFrame(5, "https://child.test/", [
      ["c-root", makeNode("c-root")],
    ]);

    const result = mergeFrameTrees({
      frames: new Map([
        [0, top],
        [5, child],
      ]),
      frameInfoMap: new Map<number, FrameInfo>([
        [5, { parentFrameId: 0, url: "https://child.test/" }],
      ]),
    });

    expect(result!.nodes.has("f5-c-root")).toBe(true);
    expect(result!.nodes.get("f5-c-root")!.parentId).toBeNull();
    expect(result!.nodeToFrame.get("f5-c-root")).toBe(5);
  });

  it("expanded UI state is set true for nodes within the first three depth levels", () => {
    const iframeNode = makeNode("ifr", {
      tagName: "iframe",
      attrs: { src: "https://child.test/" },
      depth: 1,
    });
    const top = makeFrame(0, "https://top.test", [["ifr", iframeNode]]);
    const child = makeFrame(5, "https://child.test/", [
      ["c-root", makeNode("c-root", { childIds: ["c-deep"] })],
      ["c-deep", makeNode("c-deep", { parentId: "c-root", depth: 2 })],
    ]);

    const result = mergeFrameTrees({
      frames: new Map([
        [0, top],
        [5, child],
      ]),
      frameInfoMap: new Map<number, FrameInfo>([
        [5, { parentFrameId: 0, url: "https://child.test/" }],
      ]),
    });

    // c-root sits at merged depth 2 → expanded.
    expect(result!.nodes.get("f5-c-root")!.ui.expanded).toBe(true);
    // c-deep sits at merged depth 4 → collapsed.
    expect(result!.nodes.get("f5-c-deep")!.ui.expanded).toBe(false);
  });
});

describe("buildFrameInfoMap", () => {
  it("builds a frameId-keyed map preserving parent and url", () => {
    const map = buildFrameInfoMap([
      { frameId: 0, parentFrameId: -1, url: "https://top.test" },
      { frameId: 5, parentFrameId: 0, url: "https://child.test" },
    ]);
    expect(map.get(0)).toEqual({ parentFrameId: -1, url: "https://top.test" });
    expect(map.get(5)).toEqual({ parentFrameId: 0, url: "https://child.test" });
  });

  it("returns an empty map for an empty input", () => {
    expect(buildFrameInfoMap([]).size).toBe(0);
  });
});
