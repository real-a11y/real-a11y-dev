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

  describe("multiple same-path <iframe>s in one parent", () => {
    // Ad units, YouTube consent frames and social widgets are routinely
    // embedded several times on a page, differing only by query string — or
    // not at all. Each frame must land under its OWN iframe.

    it("distinguishes sibling frames whose urls differ only by query string", () => {
      const top = makeFrame(0, "https://top.test/", [
        ["root", makeNode("root", { childIds: ["ifr-1", "ifr-2"] })],
        [
          "ifr-1",
          makeNode("ifr-1", {
            tagName: "iframe",
            attrs: { src: "https://embed.test/e?id=1" },
            parentId: "root",
            depth: 1,
          }),
        ],
        [
          "ifr-2",
          makeNode("ifr-2", {
            tagName: "iframe",
            attrs: { src: "https://embed.test/e?id=2" },
            parentId: "root",
            depth: 1,
          }),
        ],
      ]);
      const frameOne = makeFrame(5, "https://embed.test/e?id=1", [
        ["c-root", makeNode("c-root")],
      ]);
      const frameTwo = makeFrame(6, "https://embed.test/e?id=2", [
        ["c-root", makeNode("c-root")],
      ]);

      const result = mergeFrameTrees({
        frames: new Map([
          [0, top],
          [5, frameOne],
          [6, frameTwo],
        ]),
        frameInfoMap: new Map<number, FrameInfo>([
          [5, { parentFrameId: 0, url: "https://embed.test/e?id=1" }],
          [6, { parentFrameId: 0, url: "https://embed.test/e?id=2" }],
        ]),
      });

      // The query string is what tells the two embeds apart, so each frame
      // must attach to the iframe whose src carries ITS id.
      expect(result!.nodes.get("f5-c-root")!.parentId).toBe("ifr-1");
      expect(result!.nodes.get("f6-c-root")!.parentId).toBe("ifr-2");
      expect(result!.nodes.get("ifr-1")!.childIds).toEqual(["f5-c-root"]);
      expect(result!.nodes.get("ifr-2")!.childIds).toEqual(["f6-c-root"]);
    });

    it("does not attach two frames to the same <iframe> when srcs are identical", () => {
      // Same ad unit embedded twice with a byte-identical src: nothing in the
      // url can tell them apart, so the merge must at least hand each frame a
      // distinct, not-yet-claimed iframe rather than piling both onto the first.
      const top = makeFrame(0, "https://top.test/", [
        ["root", makeNode("root", { childIds: ["ifr-1", "ifr-2"] })],
        [
          "ifr-1",
          makeNode("ifr-1", {
            tagName: "iframe",
            attrs: { src: "https://ads.test/unit" },
            parentId: "root",
            depth: 1,
          }),
        ],
        [
          "ifr-2",
          makeNode("ifr-2", {
            tagName: "iframe",
            attrs: { src: "https://ads.test/unit" },
            parentId: "root",
            depth: 1,
          }),
        ],
      ]);
      const frameOne = makeFrame(5, "https://ads.test/unit", [
        ["c-root", makeNode("c-root")],
      ]);
      const frameTwo = makeFrame(6, "https://ads.test/unit", [
        ["c-root", makeNode("c-root")],
      ]);

      const result = mergeFrameTrees({
        frames: new Map([
          [0, top],
          [5, frameOne],
          [6, frameTwo],
        ]),
        frameInfoMap: new Map<number, FrameInfo>([
          [5, { parentFrameId: 0, url: "https://ads.test/unit" }],
          [6, { parentFrameId: 0, url: "https://ads.test/unit" }],
        ]),
      });

      expect(result!.nodes.get("ifr-1")!.childIds).toEqual(["f5-c-root"]);
      expect(result!.nodes.get("ifr-2")!.childIds).toEqual(["f6-c-root"]);
      expect(result!.nodes.get("f5-c-root")!.parentId).toBe("ifr-1");
      expect(result!.nodes.get("f6-c-root")!.parentId).toBe("ifr-2");
    });
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

  it("attaches a nested grandchild frame even when it announces before its parent", () => {
    // Two levels of nesting: top(0) → A(5) → B(9). All content scripts run
    // independently at document_idle, so the light grandchild B routinely
    // announces before the heavier parent A. Reproduce that by inserting B
    // into the frames map BEFORE A. The merge must still link B under A.
    const top = makeFrame(0, "https://top.test/", [
      ["root", makeNode("root", { childIds: ["ifr-a"] })],
      [
        "ifr-a",
        makeNode("ifr-a", {
          tagName: "iframe",
          attrs: { src: "https://a.test/" },
          parentId: "root",
          depth: 1,
        }),
      ],
    ]);

    const frameA = makeFrame(5, "https://a.test/", [
      ["a-root", makeNode("a-root", { childIds: ["a-ifr"] })],
      [
        "a-ifr",
        makeNode("a-ifr", {
          tagName: "iframe",
          attrs: { src: "https://b.test/" },
          parentId: "a-root",
          depth: 1,
        }),
      ],
    ]);

    const frameB = makeFrame(9, "https://b.test/", [
      ["b-root", makeNode("b-root", { childIds: ["b-1"] })],
      ["b-1", makeNode("b-1", { parentId: "b-root", depth: 1 })],
    ]);

    // Insertion order [0, 9, 5]: grandchild B announced before parent A.
    const result = mergeFrameTrees({
      frames: new Map([
        [0, top],
        [9, frameB],
        [5, frameA],
      ]),
      frameInfoMap: new Map<number, FrameInfo>([
        [5, { parentFrameId: 0, url: "https://a.test/" }],
        [9, { parentFrameId: 5, url: "https://b.test/" }],
      ]),
    });

    expect(result).not.toBeNull();

    // A's root hangs under the top frame's iframe.
    expect(result!.nodes.get("f5-a-root")!.parentId).toBe("ifr-a");
    expect(result!.nodes.get("ifr-a")!.childIds).toContain("f5-a-root");

    // B's root hangs under A's iframe — the case that used to be dropped.
    expect(result!.nodes.get("f9-b-root")!.parentId).toBe("f5-a-ifr");
    expect(result!.nodes.get("f5-a-ifr")!.childIds).toContain("f9-b-root");

    // Depths stack across both levels: ifr-a(1) → f5-a-root(2) → f5-a-ifr(3)
    // → f9-b-root(4) → f9-b-1(5). A frame-local fallback would have made
    // f9-b-root depth 1 instead.
    expect(result!.nodes.get("f5-a-root")!.depth).toBe(2);
    expect(result!.nodes.get("f5-a-ifr")!.depth).toBe(3);
    expect(result!.nodes.get("f9-b-root")!.depth).toBe(4);
    expect(result!.nodes.get("f9-b-1")!.depth).toBe(5);

    // Routing map still identifies frame ownership at every level.
    expect(result!.nodeToFrame.get("f5-a-ifr")).toBe(5);
    expect(result!.nodeToFrame.get("f9-b-root")).toBe(9);
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
    expect(result!.nodes.get("f5-c-root")!.ui!.expanded).toBe(true);
    // c-deep sits at merged depth 4 → collapsed.
    expect(result!.nodes.get("f5-c-deep")!.ui!.expanded).toBe(false);
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
