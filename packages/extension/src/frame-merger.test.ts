import type { SemanticNode } from "@real-a11y-dev/core";
import { describe, it, expect } from "vitest";

import {
  type FrameInfo,
  type FrameTree,
  asFrameMarks,
  buildFrameInfoMap,
  mergeFrameTrees,
  unplacedFrames,
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

  it("lets the live frame claim the <iframe> when a stale tree for the same url lingers", () => {
    // The caller's `frames` map is not pruned when an <iframe> ELEMENT is
    // removed: the background only drops a frame when it navigates, and a
    // deleted iframe never navigates. So after a page swaps an embed out for
    // an equal-src one (ad refresh, widget re-mount), a dead frame tree sits
    // alongside the live one, and only the live frame appears in
    // `frameInfoMap` (which is built from Chrome's getAllFrames).
    //
    // The dead frame must not be the one that claims the iframe: it has no
    // frameInfo, so frameHierarchyDepth walks a chain it isn't in and returns
    // 0, which would otherwise sort it ahead of every live child frame.
    const top = makeFrame(0, "https://top.test/", [
      ["root", makeNode("root", { childIds: ["ifr"] })],
      [
        "ifr",
        makeNode("ifr", {
          tagName: "iframe",
          attrs: { src: "https://ads.test/unit" },
          parentId: "root",
          depth: 1,
        }),
      ],
    ]);
    const staleFrame = makeFrame(5, "https://ads.test/unit", [
      ["c-root", makeNode("c-root")],
    ]);
    const liveFrame = makeFrame(9, "https://ads.test/unit", [
      ["c-root", makeNode("c-root")],
    ]);

    const result = mergeFrameTrees({
      frames: new Map([
        [0, top],
        [5, staleFrame],
        [9, liveFrame],
      ]),
      // Only frame 9 is still reported by Chrome.
      frameInfoMap: new Map<number, FrameInfo>([
        [9, { parentFrameId: 0, url: "https://ads.test/unit" }],
      ]),
    });

    // The live frame's content is what the user must see under the iframe.
    expect(result!.nodes.get("ifr")!.childIds).toEqual(["f9-c-root"]);
    expect(result!.nodes.get("f9-c-root")!.parentId).toBe("ifr");
    // The stale subtree stays addressable for routing but hangs off nothing.
    expect(result!.nodes.get("f5-c-root")!.parentId).toBeNull();
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

describe("mergeFrameTrees: frames placed by the mark on their element", () => {
  // Frames a page makes with no URL of their own all show `about:blank` or
  // `about:srcdoc`, and their <iframe>s carry no `src`: nothing in a URL
  // says which frame is in which. Each frame's script marks the element
  // holding it instead, and the tree of the document around it says which
  // of its nodes bears which mark.

  const blankIframe = (id: string) =>
    [id, makeNode(id, { tagName: "iframe", parentId: "root", depth: 1 })] as [
      string,
      SemanticNode,
    ];
  /** A top frame of three blank <iframe>s, bearing `marks` by node id. */
  const topOf = (marks: Array<[string, string]>): FrameTree => ({
    ...makeFrame(0, "https://top.test/", [
      ["root", makeNode("root", { childIds: ["ifr-1", "ifr-2", "ifr-3"] })],
      blankIframe("ifr-1"),
      blankIframe("ifr-2"),
      blankIframe("ifr-3"),
    ]),
    embeds: marks,
  });
  const blankFrame = (
    frameId: number,
    owner?: string,
    url = "about:blank",
  ): FrameTree => ({
    ...makeFrame(frameId, url, [["c-root", makeNode("c-root")]]),
    ...(owner !== undefined ? { owner } : {}),
  });
  const listed = (...frameIds: number[]) =>
    new Map<number, FrameInfo>(
      frameIds.map((id) => [id, { parentFrameId: 0, url: "about:blank" }]),
    );

  it("puts each blank frame under its own <iframe>, whatever order they announced in", () => {
    // Frame 7 is in the first <iframe> and frame 5 in the third, and they
    // announced in neither order.
    const result = mergeFrameTrees({
      frames: new Map([
        [6, blankFrame(6, "mark-2")],
        [5, blankFrame(5, "mark-3", "about:srcdoc")],
        [
          0,
          topOf([
            ["ifr-1", "mark-1"],
            ["ifr-2", "mark-2"],
            ["ifr-3", "mark-3"],
          ]),
        ],
        [7, blankFrame(7, "mark-1")],
      ]),
      frameInfoMap: listed(5, 6, 7),
    })!;

    expect(result.nodes.get("f7-c-root")!.parentId).toBe("ifr-1");
    expect(result.nodes.get("f6-c-root")!.parentId).toBe("ifr-2");
    expect(result.nodes.get("f5-c-root")!.parentId).toBe("ifr-3");
    expect(result.nodes.get("ifr-1")!.childIds).toEqual(["f7-c-root"]);
    expect(result.nodes.get("ifr-2")!.childIds).toEqual(["f6-c-root"]);
    expect(result.nodes.get("ifr-3")!.childIds).toEqual(["f5-c-root"]);
    // Under the <iframe>, at depth 1: its root at 2.
    expect(result.nodes.get("f7-c-root")!.depth).toBe(2);
    expect(result.unplaced).toEqual([]);
  });

  it("puts a frame a script wrote into under its <iframe>, though its URL is the page's", () => {
    // `document.open()` gives the frame's document the URL of the one that
    // wrote it, which matches no <iframe>'s `src`.
    const result = mergeFrameTrees({
      frames: new Map([
        [0, topOf([["ifr-2", "mark-w"]])],
        [5, blankFrame(5, "mark-w", "https://top.test/")],
      ]),
      frameInfoMap: listed(5),
    })!;
    expect(result.nodes.get("f5-c-root")!.parentId).toBe("ifr-2");
  });

  it("keeps a marked frame's <iframe> for it: no other frame is put there by the last-resort guess", () => {
    // Frame 9 marked nothing (another origin's, say) and matches no `src`.
    // The first childless <iframe> is frame 5's by its mark, whenever frame
    // 5's tree is merged, so the guess goes past it.
    const frames = new Map([
      [0, topOf([["ifr-1", "mark-1"]])],
      [9, blankFrame(9, undefined, "https://other.test/redirected")],
      [5, blankFrame(5, "mark-1")],
    ]);
    const result = mergeFrameTrees({ frames, frameInfoMap: listed(9, 5) })!;
    expect(result.nodes.get("f5-c-root")!.parentId).toBe("ifr-1");
    expect(result.nodes.get("f9-c-root")!.parentId).toBe("ifr-2");
  });

  it("guesses no <iframe> for a marked frame whose mark no tree bears yet, and says it is unplaced", () => {
    // The top frame's tree was read before frame 5's script marked its
    // element. Guessing would put it under the first childless <iframe>,
    // which may be another frame's.
    const result = mergeFrameTrees({
      frames: new Map([
        [0, topOf([])],
        [5, blankFrame(5, "mark-late")],
      ]),
      frameInfoMap: listed(5),
    })!;
    expect(result.nodes.get("f5-c-root")!.parentId).toBeNull();
    for (const id of ["ifr-1", "ifr-2", "ifr-3"]) {
      expect(result.nodes.get(id)!.childIds, id).toEqual([]);
    }
    expect(result.unplaced).toEqual([5]);
    // Its nodes are still there, for actions to route by.
    expect(result.nodeToFrame.get("f5-c-root")).toBe(5);
  });

  it("still places a marked frame by its URL while its mark is in no tree", () => {
    const top: FrameTree = makeFrame(0, "https://top.test/", [
      ["root", makeNode("root", { childIds: ["ifr"] })],
      [
        "ifr",
        makeNode("ifr", {
          tagName: "iframe",
          attrs: { src: "/widget" },
          parentId: "root",
          depth: 1,
        }),
      ],
    ]);
    const result = mergeFrameTrees({
      frames: new Map([
        [0, top],
        [5, blankFrame(5, "mark-late", "https://top.test/widget")],
      ]),
      frameInfoMap: listed(5),
    })!;
    expect(result.nodes.get("f5-c-root")!.parentId).toBe("ifr");
    // Its place by mark is still unknown, and worth asking after.
    expect(result.unplaced).toEqual([5]);
  });

  it("leaves a frame whose element the tree has no node for out of the tree, and doesn't call it unplaced", () => {
    // A hidden <iframe>, which the a11y view has no node for: the document
    // around it reports the mark with an empty node id. The frame's place
    // is known, so nobody is asked, and it is nowhere in this tree, so it
    // goes under nothing: not under the first empty <iframe> either.
    const result = mergeFrameTrees({
      frames: new Map([
        [0, topOf([["", "mark-hidden"]])],
        [5, blankFrame(5, "mark-hidden")],
      ]),
      frameInfoMap: listed(5),
    })!;
    expect(result.unplaced).toEqual([]);
    expect(result.nodes.get("f5-c-root")!.parentId).toBeNull();
    for (const id of ["ifr-1", "ifr-2", "ifr-3"]) {
      expect(result.nodes.get(id)!.childIds, id).toEqual([]);
    }
  });

  it("names the unplaced frames without merging anything", () => {
    const frames = new Map([
      [0, topOf([["ifr-1", "mark-1"]])],
      [5, blankFrame(5, "mark-1")],
      [6, blankFrame(6, "mark-late")],
      // Marked nothing: placed by URL or not at all, never by a mark.
      [7, blankFrame(7)],
    ]);
    expect(unplacedFrames(frames)).toEqual([6]);
    expect(unplacedFrames(frames)).toEqual(
      mergeFrameTrees({ frames, frameInfoMap: listed(5, 6, 7) })!.unplaced,
    );
  });

  it("takes a mark two nodes bear, or a frame's own tree bears, for no place", () => {
    const twice = mergeFrameTrees({
      frames: new Map([
        [
          0,
          topOf([
            ["ifr-1", "mark-1"],
            ["ifr-2", "mark-1"],
          ]),
        ],
        [5, blankFrame(5, "mark-1")],
      ]),
      frameInfoMap: listed(5),
    })!;
    expect(twice.nodes.get("f5-c-root")!.parentId).toBeNull();
    expect(twice.unplaced).toEqual([5]);

    const own: FrameTree = {
      ...blankFrame(5, "mark-1"),
      embeds: [["c-root", "mark-1"]],
    };
    const self = mergeFrameTrees({
      frames: new Map([
        [0, topOf([])],
        [5, own],
      ]),
      frameInfoMap: listed(5),
    })!;
    expect(self.nodes.get("f5-c-root")!.parentId).toBeNull();
  });

  it("places a frame Chrome doesn't list, and one inside it, by their marks", () => {
    // A `javascript:` frame runs the content script and is in no list of
    // the tab's frames: its parent, and that it is live at all, are known
    // by its mark alone. A frame inside it announced first.
    const outer: FrameTree = {
      ...makeFrame(5, "about:blank", [
        ["c-root", makeNode("c-root", { childIds: ["c-ifr"] })],
        [
          "c-ifr",
          makeNode("c-ifr", {
            tagName: "iframe",
            parentId: "c-root",
            depth: 1,
          }),
        ],
      ]),
      owner: "mark-outer",
      embeds: [["c-ifr", "mark-inner"]],
    };
    const result = mergeFrameTrees({
      frames: new Map([
        [8, blankFrame(8, "mark-inner")],
        [5, outer],
        [0, topOf([["ifr-3", "mark-outer"]])],
      ]),
      frameInfoMap: new Map(),
    })!;
    expect(result.nodes.get("f5-c-root")!.parentId).toBe("ifr-3");
    expect(result.nodes.get("f8-c-root")!.parentId).toBe("f5-c-ifr");
    expect(result.nodes.get("f5-c-ifr")!.childIds).toEqual(["f8-c-root"]);
    // ifr-3 at depth 1, the outer root at 2, its <iframe> at 3.
    expect(result.nodes.get("f8-c-root")!.depth).toBe(4);
  });

  it("lets a marked frame take its <iframe> from a stale tree left at the same place", () => {
    // The page swapped a blank frame for another in the same slot. The dead
    // frame's tree lingers with the mark of an element that is gone; the
    // live one's mark is on the element there now.
    const result = mergeFrameTrees({
      frames: new Map([
        [5, blankFrame(5, "mark-gone")],
        [0, topOf([["ifr-1", "mark-new"]])],
        [6, blankFrame(6, "mark-new")],
      ]),
      frameInfoMap: listed(6),
    })!;
    expect(result.nodes.get("ifr-1")!.childIds).toEqual(["f6-c-root"]);
    expect(result.nodes.get("f5-c-root")!.parentId).toBeNull();
  });

  it("holds a frame by the element's node, whatever element that is", () => {
    const top: FrameTree = {
      ...makeFrame(0, "https://top.test/", [
        ["root", makeNode("root", { childIds: ["obj"] })],
        ["obj", makeNode("obj", { tagName: "object", parentId: "root" })],
      ]),
      embeds: [["obj", "mark-1"]],
    };
    const result = mergeFrameTrees({
      frames: new Map([
        [0, top],
        [5, blankFrame(5, "mark-1", "https://top.test/doc.html")],
      ]),
      frameInfoMap: listed(5),
    })!;
    expect(result.nodes.get("f5-c-root")!.parentId).toBe("obj");
  });
});

describe("asFrameMarks", () => {
  it("takes a frame's mark and the marks its tree bears", () => {
    expect(
      asFrameMarks({
        owner: "mark-a",
        embeds: [
          ["sn-4", "mark-b"],
          ["sn-9", "mark-c"],
        ],
      }),
    ).toEqual({
      owner: "mark-a",
      embeds: [
        ["sn-4", "mark-b"],
        ["sn-9", "mark-c"],
      ],
    });
  });

  it("keeps only what is well formed: the message comes from the page's process", () => {
    expect(asFrameMarks({})).toEqual({});
    expect(asFrameMarks({ owner: 5, embeds: "x" })).toEqual({});
    expect(asFrameMarks({ owner: "", embeds: [] })).toEqual({});
    expect(asFrameMarks({ owner: "m".repeat(65) })).toEqual({});
    expect(
      asFrameMarks({
        embeds: [
          ["sn-1", "mark-a"],
          [2, "mark-b"],
          ["sn-3", 9],
          ["sn-4"],
          null,
          ["sn-5", "m".repeat(65)],
        ],
      }),
    ).toEqual({ embeds: [["sn-1", "mark-a"]] });
    const many = Array.from({ length: 600 }, (_, i) => [`sn-${i}`, `m-${i}`]);
    expect(asFrameMarks({ embeds: many }).embeds).toHaveLength(512);
    // A marked element with no node in the tree comes with an empty id.
    expect(asFrameMarks({ embeds: [["", "mark-a"]] })).toEqual({
      embeds: [["", "mark-a"]],
    });
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
