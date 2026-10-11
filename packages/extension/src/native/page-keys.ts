/**
 * Page keys: which element of the page a native row stands for, in terms the
 * content script can match with no debugger attached.
 *
 * A native row is named by Chromium's `backendDOMNodeId`, which neither page
 * script nor a content script ever sees, and the content script knows the
 * page's elements, which the debugger never names. Following the page's
 * focus in the native tree turns one into the other on every focus change,
 * and attaching to ask would put Chrome's debugging bar up on every Tab
 * press. So the native read numbers the page's elements once, while it is
 * attached anyway: the service worker over CDP (`DOM.getDocument`), the
 * content script over the live DOM, both through {@link walkPageKeys}, so an
 * element gets the same number on both sides. Each row carries its element's
 * number (`pageKey`). The content script holds each element's number by
 * identity, so a number keeps naming its element whatever the page does after
 * the read, and on a focus change it reports the numbers of the focused
 * element and of the elements above it.
 *
 * A walk covers one document: its elements, and those of every author shadow
 * root, open or closed. A frame's document is walked on its own, by the
 * content script in that frame, and matched to its CDP counterpart by the
 * mark its script left on the element holding the frame, or else by URL,
 * and by digest ({@link FramePageKeyDigest}); a frame's number names an
 * element of that frame's document only. A user-agent shadow root (a
 * `<video>`'s controls, an `<input>`'s inner editor) is left out, as page
 * script can't reach it: focus inside one is reported on the element that
 * holds it.
 */

import { safeGetAttribute } from "@real-a11y-dev/core";

import {
  asFrameMark,
  isFrameHolder,
  MAX_MARKED_FRAMES,
} from "../frame-owner.js";

/** What a walk numbered, for the two sides to compare. They disagree when
 *  the page changed between the two walks, and the numbers are then not
 *  trusted to name the same elements on both. */
export interface PageKeyDigest {
  /** How many elements the walk numbered. */
  count: number;
  /** A hash of each numbered element's local name, in walk order. */
  hash: number;
}

/** An element of a walk that holds a frame whose script marked it: the
 *  element's number, and the mark (see `frame-owner.ts`). */
export type FrameEmbed = readonly [key: number, owner: string];

/** What a content script's walk numbered: its digest, and the marked frames
 *  it came across. */
export interface PageKeyWalk extends PageKeyDigest {
  embeds?: FrameEmbed[];
}

/**
 * A frame's answer to `NATIVE_PAGE_KEYS`: the digest of its own document's
 * walk, and what tells which frame's it is. The two sides name frames
 * differently, the extension by a number and CDP by a token, with nothing
 * that turns one into the other, so the read finds each frame's document
 * among CDP's one of two ways. A frame of its parent's origin marks the
 * element holding it (`owner`), and the parent's walk reports that element's
 * number with the mark (`embeds`), which CDP's walk of the parent gives the
 * same element: that names the document exactly. Any other frame is matched
 * by its document's URL, when no other frame shows it.
 */
export interface FramePageKeyDigest extends PageKeyWalk {
  /** The frame, as the extension knows it: 0 for the top frame. */
  frameId: number;
  /** Its document's URL (`document.URL`), as CDP's `documentURL` has it. */
  url: string;
  /** The mark its script left on the element holding the frame. Absent for
   *  the top frame, and for a frame of another origin than its parent's. */
  owner?: string;
  /**
   * The tab lists the frame at an `about:` URL: it has no URL of its own.
   * Its document's URL then says nothing of which frame it is, as every
   * `about:blank` frame shares one and a frame a script wrote into
   * (`document.open()`) has the URL of the document that wrote it, so such
   * a frame is matched by its mark or not at all. The service worker sets
   * it, from the tab's list of frames.
   */
  blank?: boolean;
}

/**
 * What the tab's frames answered a read's `NATIVE_PAGE_KEYS` with: each
 * frame's answer, and the URL of each other frame the tab lists (but the top
 * one) that gave none, because it didn't answer in time or wasn't asked. A
 * document at a URL more than one frame shows, answered or not, can't be
 * told apart from the others' by URL, so the read matches none at it that
 * way.
 */
export interface FrameAnswers {
  answered: readonly FramePageKeyDigest[];
  unanswered: readonly string[];
}

/** What a read tells the numbering it asks for. */
export interface PageKeysRead {
  /** Settles once the read's own walks of the documents are in. */
  walked: Promise<unknown>;
  /** The URL of each frame the read put in the tree, as CDP's frame tree
   *  has it: the frames worth asking first. */
  frameUrls: readonly string[];
}

/** `url` without its fragment, which is no part of which document a frame
 *  shows, and which CDP's frame tree leaves out. */
export function withoutFragment(url: string): string {
  return url.split("#", 1)[0]!;
}

/** How a walk reads one side's elements. */
export interface PageKeyWalker<E> {
  /** `el` is one of the extension's own elements: see {@link isOwnElementId}. */
  isOwn(el: E): boolean;
  /** `el`'s element children, in document order. */
  children(el: E): readonly E[];
  /** The element children of `el`'s author shadow root, open or closed, or
   *  `null` when it has none. */
  shadowChildren(el: E): readonly E[] | null;
  /** `el`'s local name: `div`, `foreignObject`, `my-widget`. */
  localName(el: E): string;
}

/**
 * The extension's own elements in the page — the outline it draws, the screen
 * curtain — carry an id starting `__sn-`, which core's DOM walk leaves out the
 * same way. Both walks leave them out, with everything inside them: they come
 * and go on their own (a hover's outline cleared, the curtain lifted), outside
 * the read, so numbering them could set the two walks apart with no change to
 * the page itself.
 */
export function isOwnElementId(id: string | null | undefined): boolean {
  return id?.startsWith("__sn-") ?? false;
}

// 32-bit FNV-1a.
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
/** Ends each name in the hash, so `ab` then `c` doesn't hash as `a` then
 *  `bc`. A space, which no element's local name can hold. */
const NAME_END = 0x20;

/**
 * Number `root` and every element under it, in the one order both sides
 * walk: pre-order, an element's own children before its shadow root's, and
 * the extension's own elements left out. `visit` gets each element with its
 * number, from 0 at `root`, and its local name.
 *
 * The digest catches an element added or removed between the two walks, or
 * one moved where its name differs from what was there. A reorder of
 * like-named elements in that moment goes unnoticed, and maps focus on one
 * to the row of the other until the next read.
 */
export function walkPageKeys<E>(
  root: E,
  walker: PageKeyWalker<E>,
  visit: (el: E, key: number, localName: string) => void,
): PageKeyDigest {
  let count = 0;
  let hash = FNV_OFFSET;
  // A stack, not recursion: a deeply nested page would overflow the call
  // stack.
  const stack: E[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    if (el !== root && walker.isOwn(el)) continue;
    const name = walker.localName(el);
    visit(el, count++, name);
    for (let i = 0; i < name.length; i++) {
      hash = Math.imul(hash ^ name.charCodeAt(i), FNV_PRIME);
    }
    hash = Math.imul(hash ^ NAME_END, FNV_PRIME);
    // Pushed shadow first and in reverse, so they pop in document order,
    // light DOM first.
    const shadow = walker.shadowChildren(el);
    if (shadow) {
      for (let i = shadow.length - 1; i >= 0; i--) stack.push(shadow[i]!);
    }
    const children = walker.children(el);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
  return { count, hash: hash >>> 0 };
}

/** A node of `DOM.getDocument`'s tree, as much of it as the walk reads. */
export interface CdpDomNode {
  nodeType: number;
  backendNodeId: number;
  localName?: string;
  /** Flat: `[name, value, name, value, …]`. */
  attributes?: string[];
  children?: CdpDomNode[];
  shadowRoots?: CdpDomNode[];
  /** On a shadow root: `open`, `closed` or `user-agent`. */
  shadowRootType?: string;
  /** On a frame's `<iframe>`, the document it shows, when the frame shares
   *  the renderer of the document the `<iframe>` is in. */
  contentDocument?: CdpDomNode;
  /** On a document, its URL. */
  documentURL?: string;
}

const ELEMENT_NODE = 1;

function elementsOf(nodes: readonly CdpDomNode[] | undefined): CdpDomNode[] {
  return (nodes ?? []).filter((node) => node.nodeType === ELEMENT_NODE);
}

/** The walk over `DOM.getDocument({ depth: -1, pierce: true })`. Its
 *  `contentDocument` and `templateContent` are never read: a frame's
 *  document is another walk's, and a `<template>`'s content is a fragment
 *  outside the document, as the live DOM has it. */
export const cdpPageKeyWalker: PageKeyWalker<CdpDomNode> = {
  isOwn: (node) => {
    const attributes = node.attributes ?? [];
    for (let i = 0; i + 1 < attributes.length; i += 2) {
      if (attributes[i] === "id") return isOwnElementId(attributes[i + 1]);
    }
    return false;
  },
  children: (node) => elementsOf(node.children),
  shadowChildren: (node) => {
    const root = node.shadowRoots?.find(
      (r) => r.shadowRootType === "open" || r.shadowRootType === "closed",
    );
    return root ? elementsOf(root.children) : null;
  },
  localName: (node) => node.localName ?? "",
};

/** Number the elements of `DOM.getDocument`'s tree: each element's backend
 *  node id, to its number. `undefined` for a document with no element. */
export function cdpPageKeys(
  document: CdpDomNode,
): { keys: Map<number, number>; digest: PageKeyDigest } | undefined {
  const root = elementsOf(document.children)[0];
  if (!root) return undefined;
  const keys = new Map<number, number>();
  const digest = walkPageKeys(root, cdpPageKeyWalker, (node, key) =>
    keys.set(node.backendNodeId, key),
  );
  return { keys, digest };
}

/** A document of `DOM.getDocument`'s tree. A frame's comes with the backend
 *  node id of the element holding the frame, and the document that element
 *  is in. */
export interface CdpFrameDocument {
  document: CdpDomNode;
  ownerBackendNodeId?: number;
  within?: CdpDomNode;
}

/**
 * The documents of `DOM.getDocument({ pierce: true })`'s tree: `root` itself,
 * and the document of every frame inside it that shares its renderer,
 * however deeply they nest, each with its `<iframe>`'s backend node id and
 * the document around it, which always comes before it. A frame in a
 * renderer of its own has no document here: CDP reaches it only through
 * that frame's own session.
 */
export function cdpFrameDocuments(root: CdpDomNode): CdpFrameDocument[] {
  const out: CdpFrameDocument[] = [{ document: root }];
  // A stack, as the walk above: a deep page would overflow the call stack.
  const stack: Array<{ node: CdpDomNode; within: CdpDomNode }> = [
    { node: root, within: root },
  ];
  while (stack.length > 0) {
    const { node, within } = stack.pop()!;
    if (node.contentDocument) {
      out.push({
        document: node.contentDocument,
        ownerBackendNodeId: node.backendNodeId,
        within,
      });
      stack.push({ node: node.contentDocument, within: node.contentDocument });
    }
    // Shadow roots too: an `<iframe>` can sit inside one.
    for (const child of node.children ?? []) {
      stack.push({ node: child, within });
    }
    for (const shadow of node.shadowRoots ?? []) {
      stack.push({ node: shadow, within });
    }
  }
  return out;
}

/** A content script's reply to `NATIVE_PAGE_KEYS`, checked: anything that
 *  isn't a digest reads as no numbering at all. */
export function asPageKeyDigest(reply: unknown): PageKeyDigest | undefined {
  if (typeof reply !== "object" || reply === null) return undefined;
  const { count, hash } = reply as Partial<PageKeyDigest>;
  return Number.isSafeInteger(count) && Number.isSafeInteger(hash)
    ? { count: count!, hash: hash! }
    : undefined;
}

/** The most marked frames one walk reports, and one answer is read for. A
 *  document of more leaves the rest of its frames unmatched. */
export const MAX_FRAME_EMBEDS = MAX_MARKED_FRAMES;

/**
 * The reply of frame `frameId`'s content script to `NATIVE_PAGE_KEYS`,
 * checked as {@link asPageKeyDigest} checks one, and with its document's
 * URL. Its own mark and the marks it reports are kept only where they are
 * well formed: a content script runs in the page's process, so nothing of
 * its answer is taken on trust.
 */
export function asFramePageKeyDigest(
  reply: unknown,
  frameId: number,
): FramePageKeyDigest | undefined {
  const digest = asPageKeyDigest(reply);
  const { url, owner, embeds } = (reply ?? {}) as {
    url?: unknown;
    owner?: unknown;
    embeds?: unknown;
  };
  if (!digest || typeof url !== "string") return undefined;
  const mark = asFrameMark(owner);
  const marked: FrameEmbed[] = [];
  if (Array.isArray(embeds)) {
    for (const entry of embeds.slice(0, MAX_FRAME_EMBEDS) as unknown[]) {
      if (!Array.isArray(entry)) continue;
      const [key, held] = entry as unknown[];
      const heldMark = asFrameMark(held);
      if (Number.isSafeInteger(key) && heldMark !== undefined) {
        marked.push([key as number, heldMark]);
      }
    }
  }
  return {
    ...digest,
    frameId,
    url,
    ...(mark !== undefined ? { owner: mark } : {}),
    ...(marked.length > 0 ? { embeds: marked } : {}),
  };
}

/**
 * The walk over the live page, for the content script. Read through the
 * prototype's own accessors: on a `<form>`, a control named `children`,
 * `localName`, `shadowRoot` or `getAttribute` shadows the property, as core's
 * `clobber-safe.ts` describes. Its `safeGetAttribute` is used as it is. Its
 * readers of children and of the shadow root aren't among core's exports, and
 * the walk needs other ones anyway: it names an element by `localName`, as
 * CDP does, not by `tagName`, and needs a closed root as well as an open one.
 * They are looked up when the walker is made, not at module load: the service
 * worker loads this module too, and has no `Element`.
 *
 * `openOrClosedShadowRoot` is `chrome.dom.openOrClosedShadowRoot`, the only
 * way a content script sees a closed root, and CDP walks closed roots too.
 * Without it, a page with a closed root numbers differently on the two sides
 * and the read goes without keys. Only an HTML element can hold an author
 * shadow root, so nothing else is asked.
 */
export function livePageKeyWalker(
  openOrClosedShadowRoot?: (el: HTMLElement) => ShadowRoot | null,
): PageKeyWalker<Element> {
  const getter = (name: string) =>
    Object.getOwnPropertyDescriptor(Element.prototype, name)?.get;
  const childrenOf = getter("children");
  const localNameOf = getter("localName");
  const openShadowRootOf = getter("shadowRoot");
  const shadowRootOf = (el: Element): ShadowRoot | null => {
    if (openOrClosedShadowRoot) {
      return el instanceof HTMLElement ? openOrClosedShadowRoot(el) : null;
    }
    const root: unknown = openShadowRootOf
      ? openShadowRootOf.call(el)
      : el.shadowRoot;
    return root instanceof ShadowRoot ? root : null;
  };
  return {
    isOwn: (el) => isOwnElementId(safeGetAttribute(el, "id")),
    children: (el) =>
      Array.from(
        (childrenOf ? childrenOf.call(el) : el.children) as HTMLCollection,
      ),
    shadowChildren: (el) => {
      const root = shadowRootOf(el);
      return root ? Array.from(root.children) : null;
    },
    localName: (el) => {
      const name: unknown = localNameOf ? localNameOf.call(el) : el.localName;
      return typeof name === "string" ? name : "";
    },
  };
}

/** The document's element, read clobber-safely: a named `<img>`, `<form>`,
 *  `<embed>` or `<object>` called `documentElement` shadows the property on
 *  the document. */
export function liveDocumentElement(doc: Document): Element | null {
  const get = Object.getOwnPropertyDescriptor(
    Document.prototype,
    "documentElement",
  )?.get;
  const el: unknown = get ? get.call(doc) : doc.documentElement;
  return el instanceof Element ? el : null;
}

/** The document's URL, read clobber-safely as {@link liveDocumentElement}
 *  reads its element: an `<img name="URL">` shadows the property. */
export function liveDocumentURL(doc: Document): string {
  const get = Object.getOwnPropertyDescriptor(Document.prototype, "URL")?.get;
  const url: unknown = get ? get.call(doc) : doc.URL;
  return typeof url === "string" ? url : "";
}

/** How many reads' numberings the content script keeps: the one the panel's
 *  tree came from, a newer one whose tree hasn't reached the panel yet, and
 *  one more for a read whose tree was never used (its walks disagreed, or it
 *  failed after numbering). */
export const KEPT_PAGE_KEY_READS = 3;
/** How far a focus report climbs for numbered elements above the focused one. */
const MAX_CLIMB = 256;

/** The content script's numberings of its frame's document, by read. */
export class PageKeySnapshots {
  private reads: Array<{ readId: string; keys: WeakMap<Element, number> }> = [];

  /**
   * `parentOf` is the climb a focus report takes: core's `renderingParent`,
   * which leaves a shadow root for its host. `markOf` reads the mark the
   * frame an element holds left on it (`frameOwnerMark`), and is asked only
   * of elements that can hold a frame.
   */
  constructor(
    private readonly walker: PageKeyWalker<Element>,
    private readonly parentOf: (el: Element) => Element | null,
    private readonly markOf: (el: Element) => string | undefined = () =>
      undefined,
  ) {}

  /** Number the elements under `root` for read `readId`, replacing an
   *  earlier numbering under the same id: a read retried after the debugger
   *  dropped numbers again. The walk comes back with the marked frames it
   *  passed, for the read to find their documents by. */
  take(readId: string, root: Element): PageKeyWalk {
    const keys = new WeakMap<Element, number>();
    const embeds: FrameEmbed[] = [];
    const digest = walkPageKeys(root, this.walker, (el, key, localName) => {
      keys.set(el, key);
      if (embeds.length < MAX_FRAME_EMBEDS && isFrameHolder(localName)) {
        const mark = this.markOf(el);
        if (mark !== undefined) embeds.push([key, mark]);
      }
    });
    this.reads = [
      ...this.reads.filter((read) => read.readId !== readId),
      { readId, keys },
    ].slice(-KEPT_PAGE_KEY_READS);
    return embeds.length > 0 ? { ...digest, embeds } : digest;
  }

  /**
   * For each read kept, the numbers of `el` and of each numbered element
   * above it, nearest first: the panel takes the first that names a row of
   * its tree. An element added since the read has no number, and reports
   * those above it. When none of them has one either, the page has replaced
   * its whole document since the read (`document.open()`), and the report is
   * empty: it names no element, and still says focus is in this frame, whose
   * own row the panel then takes. `undefined` for no element, or before any
   * read.
   */
  keysFor(el: Element | null): Record<string, number[]> | undefined {
    if (!el) return undefined;
    let out: Record<string, number[]> | undefined;
    for (const { readId, keys } of this.reads) {
      const chain: number[] = [];
      let at: Element | null = el;
      for (let n = 0; at && n < MAX_CLIMB; n++, at = this.parentOf(at)) {
        const key = keys.get(at);
        if (key !== undefined) chain.push(key);
      }
      (out ??= {})[readId] = chain;
    }
    return out;
  }
}
