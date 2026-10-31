import { getNodeId } from "@real-a11y-dev/core";
import type { SemanticNode } from "@real-a11y-dev/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  type FrameTree,
  frameVisibility,
  mergeFrameTrees,
} from "./frame-merger.js";
import { markFrameOwner } from "./frame-owner.js";
import { frameSkeleton } from "./frame-skeleton.js";
import { prefixNodeId } from "./routing.js";

/** A window whose frame `holder` holds, as its script sees it. */
const frameIn = (holder: Element) =>
  ({ frameElement: holder }) as unknown as Window;

/** The document's skeleton, each element holding a frame by its `title`. */
function skeleton() {
  const result = frameSkeleton(document.documentElement);
  const nodes = new Map(result.nodes);
  const holder = (title: string): SemanticNode => {
    const el = [...document.querySelectorAll("*")]
      .concat(shadowElements())
      .find((e) => e.getAttribute("title") === title);
    if (!el) throw new Error(`no element titled ${title}`);
    const node = nodes.get(getNodeId(el));
    if (!node) throw new Error(`no node for ${title}`);
    return node;
  };
  return { ...result, map: nodes, holder };
}

/** Every element in the document's open shadow roots, however deep. */
function shadowElements(): Element[] {
  const out: Element[] = [];
  const visit = (scope: ParentNode) => {
    for (const el of scope.querySelectorAll("*")) {
      if (el.shadowRoot) {
        out.push(...el.shadowRoot.querySelectorAll("*"));
        visit(el.shadowRoot);
      }
    }
  };
  visit(document);
  return out;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("frameSkeleton", () => {
  it("is the root element and each element holding a frame under it, each a child of the root", () => {
    document.body.innerHTML = `
      <main>
        <h1>Title</h1>
        <p>Text <a href="/x">a link</a></p>
        <iframe title="First" src="/first.html"></iframe>
        <section><iframe title="Second"></iframe></section>
        <object title="Third" data="/third.html"></object>
        <embed title="Fourth" src="/fourth.svg">
        <button>Not a frame</button>
      </main>`;
    const { nodes, rootId, map, holder } = skeleton();

    expect(rootId).toBe(getNodeId(document.documentElement));
    // The root first, then one node per element holding a frame, and
    // nothing else of the page.
    expect(nodes).toHaveLength(5);
    expect(nodes[0]![0]).toBe(rootId);
    const root = map.get(rootId)!;
    expect(root).toMatchObject({
      parentId: null,
      depth: 0,
      dom: { tagName: "html" },
      a11y: { role: "document", isExposedToAT: true },
    });
    const holders = ["First", "Second", "Third", "Fourth"].map(holder);
    // In document order.
    expect(root.childIds).toEqual(holders.map((n) => n.id));
    for (const node of holders) {
      expect(node).toMatchObject({
        parentId: rootId,
        childIds: [],
        depth: 1,
        a11y: { role: "generic", name: "", isExposedToAT: true },
        dom: { isHidden: false, textContent: null, descendantText: "" },
      });
      // Keyed by its own id.
      expect(map.get(node.id)).toBe(node);
    }
    expect(holders.map((n) => n.dom?.tagName)).toEqual([
      "iframe",
      "iframe",
      "object",
      "embed",
    ]);
  });

  it("carries each element's src as written, which places a frame by its URL", () => {
    document.body.innerHTML = `
      <iframe title="Relative" src="slot.html?n=2"></iframe>
      <iframe title="None"></iframe>
      <iframe title="Empty" src=""></iframe>`;
    const { holder } = skeleton();
    expect(holder("Relative").dom?.attributes).toEqual({
      src: "slot.html?n=2",
    });
    expect(holder("None").dom?.attributes).toEqual({});
    expect(holder("Empty").dom?.attributes).toEqual({ src: "" });
  });

  it("names each element by the id the tree gives it, the same on every read", () => {
    document.body.innerHTML = `<iframe title="Frame"></iframe>`;
    const first = skeleton();
    const again = skeleton();
    expect(again.rootId).toBe(first.rootId);
    expect(again.holder("Frame").id).toBe(first.holder("Frame").id);
    expect(first.holder("Frame").id).toBe(
      getNodeId(document.querySelector("iframe")!),
    );
  });

  it("finds the elements holding frames in open shadow roots, however deep, and none in a closed one", () => {
    document.body.innerHTML = `
      <iframe title="Light"></iframe>
      <div id="host"></div>
      <div id="closed"></div>`;
    const host = document.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<iframe title="Shadow"></iframe><span id="inner"></span>`;
    const inner = shadow.getElementById("inner")!;
    inner
      .attachShadow({ mode: "open" })
      .append(
        Object.assign(document.createElement("iframe"), { title: "Deeper" }),
      );
    document
      .getElementById("closed")!
      .attachShadow({ mode: "closed" })
      .append(
        Object.assign(document.createElement("iframe"), { title: "Closed" }),
      );

    const { nodes, map, rootId, holder } = skeleton();
    expect(nodes).toHaveLength(4);
    // The tree around a shadow root first, then the shadow root's own.
    expect(map.get(rootId)!.childIds).toEqual(
      ["Light", "Shadow", "Deeper"].map((t) => holder(t).id),
    );
    // A shadow host with no slot renders nothing of its light DOM, but its
    // shadow tree is rendered: these are exposed.
    expect(holder("Shadow").a11y.isExposedToAT).toBe(true);
    expect(holder("Deeper").a11y.isExposedToAT).toBe(true);
  });

  it("finds those in the root element's own shadow root after the tree around it", () => {
    const root = document.createElement("x-app");
    root.append(
      Object.assign(document.createElement("iframe"), { title: "Light" }),
    );
    root
      .attachShadow({ mode: "open" })
      .append(
        Object.assign(document.createElement("iframe"), { title: "Own" }),
        document.createElement("slot"),
      );
    const { nodes, rootId } = frameSkeleton(root);
    const titles = new Map(
      [root, ...root.children, ...root.shadowRoot!.children].map((el) => [
        getNodeId(el),
        el.getAttribute("title"),
      ]),
    );
    expect(
      new Map(nodes).get(rootId)!.childIds.map((id) => titles.get(id)),
    ).toEqual(["Light", "Own"]);
  });

  it("keeps an element holding a frame that is hidden, or inside something hiding what it holds, unexposed", () => {
    document.body.innerHTML = `
      <iframe title="Shown"></iframe>
      <iframe title="Display none" style="display: none"></iframe>
      <iframe title="Hidden attribute" hidden></iframe>
      <iframe title="Visibility hidden" style="visibility: hidden"></iframe>
      <iframe title="Aria hidden" aria-hidden="true"></iframe>
      <div aria-hidden="true"><div><iframe title="In aria hidden"></iframe></div></div>
      <div style="display: none"><iframe title="In display none"></iframe></div>
      <div inert><iframe title="In inert"></iframe></div>
      <details><summary>More</summary><iframe title="In closed details"></iframe></details>
      <details open><summary>More</summary><iframe title="In open details"></iframe></details>
      <div aria-hidden="false"><iframe title="In aria hidden false"></iframe></div>
      <div id="host"><iframe title="Not slotted"></iframe></div>`;
    document.getElementById("host")!.attachShadow({ mode: "open" });

    const { holder } = skeleton();
    const exposed = (title: string) => {
      const node = holder(title);
      // One verdict, read either way.
      expect(node.dom?.isHidden, title).toBe(!node.a11y.isExposedToAT);
      return node.a11y.isExposedToAT;
    };
    for (const title of ["Shown", "In open details", "In aria hidden false"]) {
      expect(exposed(title), title).toBe(true);
    }
    for (const title of [
      "Display none",
      "Hidden attribute",
      "Visibility hidden",
      "Aria hidden",
      "In aria hidden",
      "In display none",
      "In inert",
      "In closed details",
      "Not slotted",
    ]) {
      expect(exposed(title), title).toBe(false);
    }
  });

  it("lists each element holding a frame whose script marked it, hidden or not, with its node id", () => {
    document.body.innerHTML = `
      <iframe title="Marked"></iframe>
      <iframe title="Unmarked"></iframe>
      <iframe title="Marked hidden" style="display: none"></iframe>`;
    const [marked, , hidden] = document.querySelectorAll("iframe");
    markFrameOwner(frameIn(marked!), "mark-shown");
    markFrameOwner(frameIn(hidden!), "mark-hidden");

    const { embeds, holder } = skeleton();
    expect(embeds).toEqual([
      [holder("Marked").id, "mark-shown"],
      [holder("Marked hidden").id, "mark-hidden"],
    ]);
  });

  it("places each frame under its own element as a tree does, and a hidden one's is hidden", () => {
    // Where the a11y view has no node for the hidden <iframe>, so that the
    // ad's frame, of another origin and announcing first, would take the
    // video's by its URL without the query.
    const top = "https://top.test/page";
    const ad = "https://ads.test/slot?id=1";
    const video = "https://ads.test/slot?id=2";
    document.body.innerHTML = `
      <iframe title="Ad" src="${ad}" style="display: none"></iframe>
      <iframe title="Video" src="${video}"></iframe>`;
    const page = frameSkeleton(document.documentElement);
    const frame = (frameId: number, frameUrl: string): FrameTree => ({
      frameId,
      frameUrl,
      pageTitle: "",
      ...frameSkeleton(
        document.implementation.createHTMLDocument("").documentElement,
      ),
      framesOnly: true,
    });
    const frames = new Map<number, FrameTree>([
      [0, { ...frame(0, top), ...page }],
      [1, frame(1, ad)],
      [2, frame(2, video)],
    ]);
    const result = mergeFrameTrees({
      frames,
      frameInfoMap: new Map([
        [0, { parentFrameId: -1, url: top }],
        [1, { parentFrameId: 0, url: ad }],
        [2, { parentFrameId: 0, url: video }],
      ]),
    })!;

    const [adFrame, videoFrame] = document.querySelectorAll("iframe");
    const rootOf = (frameId: number) =>
      result.nodes.get(prefixNodeId(frameId, frames.get(frameId)!.rootId));
    expect(rootOf(1)?.parentId).toBe(getNodeId(adFrame!));
    expect(rootOf(2)?.parentId).toBe(getNodeId(videoFrame!));
    expect(frameVisibility(result.nodes, frames.get(1)!, page.rootId)).toBe(
      "hidden",
    );
    expect(frameVisibility(result.nodes, frames.get(2)!, page.rootId)).toBe(
      "shown",
    );
  });

  it("is the root alone for a document holding no frame", () => {
    document.body.innerHTML = `<p>Just text</p>`;
    const { nodes, rootId, embeds } = frameSkeleton(document.documentElement);
    expect(nodes).toEqual([
      [rootId, expect.objectContaining({ childIds: [] })],
    ]);
    expect(embeds).toEqual([]);
  });
});
