import { renderingParent } from "@real-a11y-dev/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  asFramePageKeyDigest,
  asPageKeyDigest,
  cdpFrameDocuments,
  cdpPageKeys,
  KEPT_PAGE_KEY_READS,
  liveDocumentElement,
  liveDocumentURL,
  livePageKeyWalker,
  MAX_FRAME_EMBEDS,
  PageKeySnapshots,
  walkPageKeys,
  type CdpDomNode,
} from "./page-keys.js";

/** Closed shadow roots, which only `chrome.dom.openOrClosedShadowRoot` sees
 *  in a content script: kept here as each is attached. Like that API, this
 *  reads past a form control named `shadowRoot`. */
const closedRoots = new WeakMap<Element, ShadowRoot>();
const element =
  <T>(name: string) =>
  (el: Element) =>
    Object.getOwnPropertyDescriptor(Element.prototype, name)!.get!.call(
      el,
    ) as T;
const openShadowRoot = element<ShadowRoot | null>("shadowRoot");
const localName = element<string>("localName");
const openOrClosed = (el: HTMLElement) =>
  openShadowRoot(el) ?? closedRoots.get(el) ?? null;
const liveWalker = livePageKeyWalker(openOrClosed);

/** `CdpDomNode`, with the fields of `DOM.getDocument`'s nodes the walk must
 *  never follow. */
type FullCdpNode = CdpDomNode & {
  children?: FullCdpNode[];
  shadowRoots?: FullCdpNode[];
  templateContent?: FullCdpNode;
  contentDocument?: FullCdpNode;
};

/**
 * What `DOM.getDocument({ depth: -1, pierce: true })` sends for `doc`, as
 * far as the walk reads it: every node, text and comments included, with a
 * backend id; each shadow root with its type, a user-agent one included
 * where `uaRoot` says an element has one; a frame's document and a
 * template's content where CDP puts them. `ids` records each node's id.
 */
function cdpDocument(
  doc: Document,
  ids: Map<Node, number>,
  uaRoot: (el: Element) => boolean = () => false,
): FullCdpNode {
  let next = 1;
  const idOf = (node: Node) => {
    if (!ids.has(node)) ids.set(node, next++);
    return ids.get(node)!;
  };
  const convert = (node: Node): FullCdpNode => {
    const out: FullCdpNode = {
      nodeType: node.nodeType,
      backendNodeId: idOf(node),
    };
    const children = [...node.childNodes].map(convert);
    if (children.length > 0) out.children = children;
    if (node instanceof Element) {
      out.localName = localName(node);
      const attributes = [...node.attributes].flatMap((a) => [a.name, a.value]);
      if (attributes.length > 0) out.attributes = attributes;
      const author = openOrClosed(node as HTMLElement);
      if (author) {
        out.shadowRoots = [{ ...convert(author), shadowRootType: author.mode }];
      } else if (uaRoot(node)) {
        out.shadowRoots = [
          {
            nodeType: 11,
            backendNodeId: next++,
            shadowRootType: "user-agent",
            children: [
              { nodeType: 1, backendNodeId: next++, localName: "div" },
            ],
          },
        ];
      }
      if (node instanceof HTMLTemplateElement) {
        out.templateContent = convert(node.content);
      }
      if (node instanceof HTMLIFrameElement) {
        // A frame's document: elements of its own, never walked here.
        out.contentDocument = {
          nodeType: 9,
          backendNodeId: next++,
          children: [{ nodeType: 1, backendNodeId: next++, localName: "html" }],
        };
      }
    }
    return out;
  };
  return convert(doc);
}

/** Each element's number in the live walk, by element. */
function liveKeys(root: Element): Map<Element, number> {
  const keys = new Map<Element, number>();
  walkPageKeys(root, liveWalker, (el, key) => keys.set(el, key));
  return keys;
}

const PAGE = `
  <header><h1>Title</h1></header>
  <form aria-label="Clobbering">
    <input name="children" />
    <input name="localName" />
    <input name="shadowRoot" />
    <select><option>One</option></select>
  </form>
  <template><button>In a template</button></template>
  <iframe title="Frame"></iframe>
  <svg><foreignObject><div>In SVG</div></foreignObject></svg>
  <nav><a href="#a">A</a><div><div><a href="#b">B</a></div></div></nav>
  <div id="open-host"><span slot="label">Slotted</span></div>
  <div id="closed-host"></div>
  <main><button id="last">Last</button></main>
`;

function buildPage(): void {
  document.body.innerHTML = PAGE;
  const open = document
    .getElementById("open-host")!
    .attachShadow({ mode: "open" });
  open.innerHTML =
    '<div role="group"><slot name="label"></slot><button id="in-open">In open</button></div>';
  const host = document.getElementById("closed-host")!;
  const closed = host.attachShadow({ mode: "closed" });
  closedRoots.set(host, closed);
  closed.innerHTML = '<button id="in-closed">In closed</button>';
}

/**
 * What a `<form>` does in a real browser, which jsdom's named properties
 * don't reliably: its controls shadow the properties the walk reads. Undone
 * by the function returned, since jsdom's own selector engine reads them too.
 */
function clobberForm(): () => void {
  const form = document.querySelector("form")!;
  const names = ["children", "localName", "shadowRoot"];
  for (const name of names) {
    const control = form.querySelector(`[name="${name}"]`);
    Object.defineProperty(form, name, {
      configurable: true,
      get: () => control,
    });
  }
  return () => {
    for (const name of names)
      delete (form as unknown as Record<string, unknown>)[name];
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("walkPageKeys", () => {
  it("numbers pre-order from 0, an element's own children before its shadow root's", () => {
    type N = { name: string; kids?: N[]; shadow?: N[] };
    const tree: N = {
      name: "a",
      kids: [{ name: "b", kids: [{ name: "c" }] }, { name: "d" }],
      shadow: [{ name: "e" }],
    };
    const order: string[] = [];
    const digest = walkPageKeys(
      tree,
      {
        children: (n) => n.kids ?? [],
        shadowChildren: (n) => n.shadow ?? null,
        localName: (n) => n.name,
        isOwn: () => false,
      },
      (n, key) => order.push(`${key}:${n.name}`),
    );
    expect(order).toEqual(["0:a", "1:b", "2:c", "3:d", "4:e"]);
    expect(digest.count).toBe(5);
  });

  it("hashes the names in order, each name ended, so a different page hashes differently", () => {
    const walker = {
      children: (n: string[]) => n.slice(1).map((name) => [name]),
      shadowChildren: () => null,
      localName: (n: string[]) => n[0]!,
      isOwn: () => false,
    };
    const hash = (names: string[]) =>
      walkPageKeys(names, walker, () => {}).hash;
    expect(hash(["div", "ab", "c"])).toBe(hash(["div", "ab", "c"]));
    expect(hash(["div", "ab", "c"])).not.toBe(hash(["div", "a", "bc"]));
    expect(hash(["div", "ab", "c"])).not.toBe(hash(["div", "c", "ab"]));
  });

  it("walks a page nested deeper than the call stack would allow", () => {
    type N = { kid?: N };
    const root: N = {};
    let at = root;
    for (let i = 0; i < 100_000; i++) at = at.kid = {};
    const { count } = walkPageKeys(
      root,
      {
        children: (n) => (n.kid ? [n.kid] : []),
        shadowChildren: () => null,
        localName: () => "div",
        isOwn: () => false,
      },
      () => {},
    );
    expect(count).toBe(100_001);
  });
});

describe("the two walks of a page", () => {
  it("number every element alike: light DOM, open and closed shadow roots, through a clobbering form", () => {
    buildPage();
    const ids = new Map<Node, number>();
    const restore = clobberForm();
    let cdp: ReturnType<typeof cdpPageKeys>;
    let live: Map<Element, number>;
    try {
      cdp = cdpPageKeys(cdpDocument(document, ids))!;
      live = liveKeys(liveDocumentElement(document)!);
    } finally {
      restore();
    }

    expect(cdp!.digest).toEqual(
      walkPageKeys(document.documentElement, liveWalker, () => {}),
    );
    expect(cdp!.keys.size).toBe(live!.size);
    for (const [el, key] of live!) {
      expect(cdp!.keys.get(ids.get(el)!), el.outerHTML).toBe(key);
    }
    // Inside both shadow roots, and the form's own controls.
    for (const el of [
      document
        .getElementById("open-host")!
        .shadowRoot!.getElementById("in-open")!,
      closedRoots
        .get(document.getElementById("closed-host")!)!
        .getElementById("in-closed")!,
      document.querySelector('[name="children"]')!,
    ]) {
      expect(live!.has(el)).toBe(true);
    }
  });

  it("leave out a template's content, a frame's document and a user-agent shadow root", () => {
    buildPage();
    const ids = new Map<Node, number>();
    const doc = cdpDocument(document, ids, (el) => el.localName === "input");
    const cdp = cdpPageKeys(doc)!;
    const live = liveKeys(document.documentElement);
    expect(cdp.digest.count).toBe(live.size);
    const template = document.querySelector("template")!;
    expect(cdp.keys.has(ids.get(template.content.firstElementChild!)!)).toBe(
      false,
    );
  });

  it("leave out the extension's own elements, and everything inside them, which come and go on their own", () => {
    buildPage();
    const before = cdpPageKeys(cdpDocument(document, new Map()))!.digest;
    const overlay = document.createElement("div");
    overlay.id = "__sn-highlight";
    overlay.append(document.createElement("span"));
    const curtain = document.createElement("div");
    curtain.id = "__sn-curtain";
    curtain.innerHTML = "<div>Screen Curtain</div>";
    document.documentElement.append(overlay, curtain);
    try {
      const ids = new Map<Node, number>();
      const cdp = cdpPageKeys(cdpDocument(document, ids))!;
      const live = walkPageKeys(document.documentElement, liveWalker, () => {});
      expect(cdp.digest).toEqual(live);
      // As if they weren't there: a read can't be set apart by one drawn or
      // cleared between its two walks.
      expect(live).toEqual(before);
      expect(cdp.keys.has(ids.get(overlay)!)).toBe(false);
      expect(cdp.keys.has(ids.get(curtain.firstElementChild!)!)).toBe(false);
    } finally {
      overlay.remove();
      curtain.remove();
    }
  });

  it("disagree once the page changes between them", () => {
    buildPage();
    const doc = cdpDocument(document, new Map());
    document.querySelector("nav")!.append(document.createElement("span"));
    const live = walkPageKeys(document.documentElement, liveWalker, () => {});
    expect(cdpPageKeys(doc)!.digest).not.toEqual(live);
  });

  it("disagree on a closed shadow root the content script can't see", () => {
    buildPage();
    const doc = cdpDocument(document, new Map());
    const openOnly = livePageKeyWalker();
    const live = walkPageKeys(document.documentElement, openOnly, () => {});
    expect(cdpPageKeys(doc)!.digest).not.toEqual(live);
  });
});

describe("cdpPageKeys", () => {
  it("numbers nothing in a document with no element", () => {
    expect(
      cdpPageKeys({
        nodeType: 9,
        backendNodeId: 1,
        children: [{ nodeType: 10, backendNodeId: 2 }],
      }),
    ).toBeUndefined();
  });
});

describe("liveDocumentElement", () => {
  it("reads past a named element that shadows the document's property", () => {
    const img = document.createElement("img");
    Object.defineProperty(document, "documentElement", {
      configurable: true,
      get: () => img,
    });
    try {
      expect(liveDocumentElement(document)?.localName).toBe("html");
    } finally {
      delete (document as { documentElement?: unknown }).documentElement;
    }
  });
});

describe("liveDocumentURL", () => {
  it("reads past a named element that shadows the document's property", () => {
    const img = document.createElement("img");
    Object.defineProperty(document, "URL", {
      configurable: true,
      get: () => img,
    });
    try {
      expect(liveDocumentURL(document)).toBe(location.href);
    } finally {
      delete (document as { URL?: unknown }).URL;
    }
  });
});

describe("cdpFrameDocuments", () => {
  /** A `DOM.getDocument` element. */
  const el = (
    localName: string,
    backendNodeId: number,
    children: CdpDomNode[] = [],
    extra: Partial<CdpDomNode> = {},
  ): CdpDomNode => ({
    nodeType: 1,
    backendNodeId,
    localName,
    children,
    ...extra,
  });
  const doc = (backendNodeId: number, url: string, ...children: CdpDomNode[]) =>
    ({ nodeType: 9, backendNodeId, documentURL: url, children }) as CdpDomNode;

  it("finds the document of every frame sharing its renderer, however deep, in a shadow root too, each with its frame's element", () => {
    const deep = doc(40, "https://a.test/deep", el("html", 41));
    const frame = doc(
      20,
      "https://a.test/frame",
      el("html", 21, [
        el("body", 22, [el("iframe", 23, [], { contentDocument: deep })]),
      ]),
    );
    const inShadow = doc(60, "https://a.test/shadow", el("html", 61));
    const root = doc(
      1,
      "https://a.test/",
      el("html", 2, [
        el("body", 3, [
          el("iframe", 10, [], { contentDocument: frame }),
          // In a renderer of its own: no document here.
          el("iframe", 11),
          el("div", 12, [], {
            shadowRoots: [
              {
                nodeType: 11,
                backendNodeId: 13,
                shadowRootType: "open",
                children: [el("iframe", 14, [], { contentDocument: inShadow })],
              },
            ],
          }),
        ]),
      ]),
    );
    const found = cdpFrameDocuments(root)
      .map(({ document, ownerBackendNodeId }) => [
        document.documentURL,
        ownerBackendNodeId,
      ])
      .sort();
    expect(found).toEqual([
      ["https://a.test/", undefined],
      ["https://a.test/deep", 23],
      ["https://a.test/frame", 10],
      ["https://a.test/shadow", 14],
    ]);
    // Each is walked on its own: the top document's walk stops at the
    // <iframe>, and the frame's numbers its elements from 0.
    expect(cdpPageKeys(root)!.keys.has(21)).toBe(false);
    expect(cdpPageKeys(frame)!.keys.get(21)).toBe(0);
  });

  it("is the document alone when no frame shares its renderer", () => {
    const root = doc(1, "https://a.test/", el("html", 2, [el("iframe", 3)]));
    expect(cdpFrameDocuments(root)).toEqual([{ document: root }]);
  });

  it("gives each frame's document the document its <iframe> is in, which comes first", () => {
    const deep = doc(40, "about:srcdoc", el("html", 41));
    const frame = doc(
      20,
      "about:blank",
      el("html", 21, [
        el("body", 22, [
          // In a shadow root of the frame's document: still that document's.
          el("div", 24, [], {
            shadowRoots: [
              {
                nodeType: 11,
                backendNodeId: 25,
                shadowRootType: "closed",
                children: [el("iframe", 23, [], { contentDocument: deep })],
              },
            ],
          }),
        ]),
      ]),
    );
    const sibling = doc(60, "about:blank", el("html", 61));
    const root = doc(
      1,
      "https://a.test/",
      el("html", 2, [
        el("body", 3, [
          el("iframe", 10, [], { contentDocument: frame }),
          el("iframe", 11, [], { contentDocument: sibling }),
        ]),
      ]),
    );
    const found = cdpFrameDocuments(root);
    const of = (document: CdpDomNode) =>
      found.find((f) => f.document === document)!;
    expect(of(root).within).toBeUndefined();
    expect(of(frame).within).toBe(root);
    expect(of(sibling).within).toBe(root);
    expect(of(deep).within).toBe(frame);
    for (const { document, within } of found) {
      if (!within) continue;
      expect(
        found.findIndex((f) => f.document === within),
        document.documentURL,
      ).toBeLessThan(found.findIndex((f) => f.document === document));
    }
  });
});

describe("asFramePageKeyDigest", () => {
  it("takes a digest with its document's URL, as the frame it was asked of", () => {
    const url = "https://a.test/frame";
    expect(asFramePageKeyDigest({ count: 3, hash: 7, url }, 4)).toEqual({
      count: 3,
      hash: 7,
      frameId: 4,
      url,
    });
    // The frame is the one asked, whatever the reply says it is.
    expect(
      asFramePageKeyDigest({ count: 3, hash: 7, url, frameId: 0 }, 4)?.frameId,
    ).toBe(4);
  });

  it("takes nothing that can't be matched: no URL, or no digest", () => {
    expect(asFramePageKeyDigest({ count: 3, hash: 7 }, 4)).toBeUndefined();
    expect(
      asFramePageKeyDigest({ count: 3, hash: 7, url: 5 }, 4),
    ).toBeUndefined();
    expect(
      asFramePageKeyDigest({ count: "3", hash: 7, url: "x" }, 4),
    ).toBeUndefined();
    expect(asFramePageKeyDigest(null, 0)).toBeUndefined();
    expect(asFramePageKeyDigest("x", 0)).toBeUndefined();
  });

  it("takes the frame's mark, and the marked frames its walk passed", () => {
    expect(
      asFramePageKeyDigest(
        {
          count: 3,
          hash: 7,
          url: "about:blank",
          owner: "mark-a",
          embeds: [
            [4, "mark-b"],
            [9, "mark-c"],
          ],
        },
        4,
      ),
    ).toEqual({
      count: 3,
      hash: 7,
      frameId: 4,
      url: "about:blank",
      owner: "mark-a",
      embeds: [
        [4, "mark-b"],
        [9, "mark-c"],
      ],
    });
  });

  it("keeps of the marks only what is well formed: the script answers from the page's process", () => {
    const reply = (extra: object) =>
      asFramePageKeyDigest({ count: 3, hash: 7, url: "x", ...extra }, 4)!;
    // The answer still stands without them.
    expect(reply({ owner: 5, embeds: "none" })).toEqual({
      count: 3,
      hash: 7,
      frameId: 4,
      url: "x",
    });
    expect(reply({ owner: "" }).owner).toBeUndefined();
    expect(reply({ owner: "m".repeat(65) }).owner).toBeUndefined();
    expect(
      reply({
        embeds: [
          [1, "mark-a"],
          ["2", "mark-b"],
          [3, 9],
          [4.5, "mark-c"],
          [5],
          null,
          [6, "m".repeat(65)],
          [7, "mark-d", "more"],
        ],
      }).embeds,
    ).toEqual([
      [1, "mark-a"],
      [7, "mark-d"],
    ]);
    // No more than a walk reports.
    const many = Array.from({ length: MAX_FRAME_EMBEDS + 40 }, (_, i) => [
      i,
      `mark-${i}`,
    ]);
    expect(reply({ embeds: many }).embeds).toHaveLength(MAX_FRAME_EMBEDS);
    // It can't say it has no URL of its own: the tab's list of frames does.
    expect(reply({ blank: true }).blank).toBeUndefined();
    // Nor which frame holds it.
    expect(reply({ parent: 0 }).parent).toBeUndefined();
  });
});

describe("asPageKeyDigest", () => {
  it("takes a digest, and nothing else", () => {
    expect(asPageKeyDigest({ count: 3, hash: 7 })).toEqual({
      count: 3,
      hash: 7,
    });
    expect(asPageKeyDigest(null)).toBeUndefined();
    expect(asPageKeyDigest(undefined)).toBeUndefined();
    expect(asPageKeyDigest({ count: "3", hash: 7 })).toBeUndefined();
    expect(asPageKeyDigest({ count: 3 })).toBeUndefined();
    expect(asPageKeyDigest({ count: 1.5, hash: 7 })).toBeUndefined();
  });
});

describe("PageKeySnapshots", () => {
  const snapshots = () => new PageKeySnapshots(liveWalker, renderingParent);

  it("reports the focused element's number and each above it, nearest first", () => {
    buildPage();
    const keys = liveKeys(document.documentElement);
    const store = snapshots();
    store.take("read-1", document.documentElement);
    const last = document.getElementById("last")!;
    expect(store.keysFor(last)).toEqual({
      "read-1": [
        keys.get(last)!,
        keys.get(document.querySelector("main")!)!,
        keys.get(document.body)!,
        keys.get(document.documentElement)!,
      ],
    });
  });

  it("climbs out of a shadow root to its host", () => {
    buildPage();
    const keys = liveKeys(document.documentElement);
    const store = snapshots();
    store.take("read-1", document.documentElement);
    const host = document.getElementById("closed-host")!;
    const inside = closedRoots.get(host)!.getElementById("in-closed")!;
    const chain = store.keysFor(inside)!["read-1"]!;
    expect(chain.slice(0, 2)).toEqual([keys.get(inside), keys.get(host)]);
  });

  it("keeps an element's number when the page changes around it, and an element added since reports those above it", () => {
    buildPage();
    const keys = liveKeys(document.documentElement);
    const store = snapshots();
    store.take("read-1", document.documentElement);
    document.body.prepend(document.createElement("p"));
    const main = document.querySelector("main")!;
    const added = document.createElement("button");
    main.append(added);
    expect(store.keysFor(document.getElementById("last")!)!["read-1"]![0]).toBe(
      keys.get(document.getElementById("last")!),
    );
    expect(store.keysFor(added)!["read-1"]![0]).toBe(keys.get(main));
  });

  it("reports under every read kept, the last few only, and a read taken again replaces its numbering", () => {
    buildPage();
    const store = snapshots();
    const last = document.getElementById("last")!;
    for (let i = 1; i <= KEPT_PAGE_KEY_READS + 1; i++) {
      store.take(`read-${i}`, document.documentElement);
    }
    const reads = Object.keys(store.keysFor(last)!);
    expect(reads).toEqual(
      Array.from({ length: KEPT_PAGE_KEY_READS }, (_, i) => `read-${i + 2}`),
    );
    // Retaken (a read retried after a drop), it doesn't count twice.
    document.body.prepend(document.createElement("p"));
    store.take(`read-${KEPT_PAGE_KEY_READS + 1}`, document.documentElement);
    expect(Object.keys(store.keysFor(last)!)).toHaveLength(KEPT_PAGE_KEY_READS);
    const retaken = store.keysFor(last)![`read-${KEPT_PAGE_KEY_READS + 1}`]!;
    expect(retaken[0]).toBe(liveKeys(document.documentElement).get(last));
  });

  it("reports nothing before a read, or for nothing", () => {
    buildPage();
    const store = snapshots();
    expect(store.keysFor(document.getElementById("last"))).toBeUndefined();
    store.take("read-1", document.documentElement);
    expect(store.keysFor(null)).toBeUndefined();
  });

  it("reports an empty chain under each read when nothing above the element was numbered: the document was replaced", () => {
    buildPage();
    const store = snapshots();
    store.take("read-1", document.documentElement);
    store.take("read-2", document.documentElement);
    // What `document.open()` leaves: elements no read has seen, up to the
    // root. Stood in for by a tree out of the document.
    const html = document.createElement("html");
    html.innerHTML = `<body><button>New</button></body>`;
    expect(store.keysFor(html.querySelector("button"))).toEqual({
      "read-1": [],
      "read-2": [],
    });
  });

  describe("the marked frames a walk passes", () => {
    const marks = new WeakMap<Element, string>();
    const asked: Element[] = [];
    const marked = () =>
      new PageKeySnapshots(liveWalker, renderingParent, (el) => {
        asked.push(el);
        return marks.get(el);
      });

    it("come back with the walk, each by its element's number", () => {
      document.body.innerHTML = `<main>
        <iframe id="one"></iframe>
        <p>Between</p>
        <div id="host"></div>
        <iframe id="none"></iframe>
        <object id="two"></object>
      </main>`;
      // In a shadow root too, as the walk goes there.
      const inShadow = document.createElement("iframe");
      document
        .getElementById("host")!
        .attachShadow({ mode: "open" })
        .append(inShadow);
      const [one, two] = ["one", "two"].map((id) =>
        document.getElementById(id)!,
      );
      marks.set(one!, "mark-1");
      marks.set(two!, "mark-2");
      marks.set(inShadow, "mark-3");
      const keys = liveKeys(document.documentElement);
      const walk = marked().take("read-1", document.documentElement);
      expect(walk).toEqual({
        ...walkPageKeys(document.documentElement, liveWalker, () => {}),
        embeds: [
          [keys.get(one!), "mark-1"],
          [keys.get(inShadow), "mark-3"],
          [keys.get(two!), "mark-2"],
        ],
      });
    });

    it("are asked after only where an element can hold a frame", () => {
      document.body.innerHTML = `<main><p>Text</p><iframe></iframe><embed /></main>`;
      asked.length = 0;
      const walk = marked().take("read-1", document.documentElement);
      expect(asked.map((el) => el.localName)).toEqual(["iframe", "embed"]);
      // None marked: the answer is the digest alone.
      expect(walk).toEqual(
        walkPageKeys(document.documentElement, liveWalker, () => {}),
      );
    });

    it("stop at as many as an answer is read for", () => {
      // Out of the document, where jsdom would load a frame into each.
      const main = document.createElement("main");
      for (let i = 0; i < MAX_FRAME_EMBEDS + 5; i++) {
        const iframe = document.createElement("iframe");
        marks.set(iframe, `mark-${i}`);
        main.append(iframe);
      }
      const walk = marked().take("read-1", main);
      expect(walk.embeds).toHaveLength(MAX_FRAME_EMBEDS);
      expect(walk.count).toBe(MAX_FRAME_EMBEDS + 5 + 1);
    });
  });
});
