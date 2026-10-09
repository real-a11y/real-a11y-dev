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
 * The walk covers the top document: its elements, and those of every author
 * shadow root, open or closed. A frame's document is left out (another
 * content script, another walk), and so is a user-agent shadow root (a
 * `<video>`'s controls, an `<input>`'s inner editor), which page script can't
 * reach: focus inside either is reported on the element that holds it.
 */

/** What a walk numbered, for the two sides to compare. They disagree when
 *  the page changed between the two walks, and the numbers are then not
 *  trusted to name the same elements on both. */
export interface PageKeyDigest {
  /** How many elements the walk numbered. */
  count: number;
  /** A hash of each numbered element's local name, in walk order. */
  hash: number;
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
 * number, from 0 at `root`.
 *
 * The digest catches an element added or removed between the two walks, or
 * one moved where its name differs from what was there. A reorder of
 * like-named elements in that moment goes unnoticed, and maps focus on one
 * to the row of the other until the next read.
 */
export function walkPageKeys<E>(
  root: E,
  walker: PageKeyWalker<E>,
  visit: (el: E, key: number) => void,
): PageKeyDigest {
  let count = 0;
  let hash = FNV_OFFSET;
  // A stack, not recursion: a deeply nested page would overflow the call
  // stack.
  const stack: E[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    if (el !== root && walker.isOwn(el)) continue;
    visit(el, count++);
    const name = walker.localName(el);
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

/** A content script's reply to `NATIVE_PAGE_KEYS`, checked: anything that
 *  isn't a digest reads as no numbering at all. */
export function asPageKeyDigest(reply: unknown): PageKeyDigest | undefined {
  if (typeof reply !== "object" || reply === null) return undefined;
  const { count, hash } = reply as Partial<PageKeyDigest>;
  return Number.isSafeInteger(count) && Number.isSafeInteger(hash)
    ? { count: count!, hash: hash! }
    : undefined;
}

/**
 * The walk over the live page, for the content script. Read through the
 * prototype's own accessors: on a `<form>`, a control named `children`,
 * `localName`, `shadowRoot` or `getAttribute` shadows the property, as core's
 * `clobber-safe.ts` describes. Its helpers aren't core's exports, and two
 * would read differently anyway: this walk names an element by `localName`,
 * as CDP does, not by `tagName`, and needs a closed root as well as an open
 * one. They are looked up when the walker is made, not at module load: the
 * service worker loads this module too, and has no `Element`.
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
  const getAttribute = Element.prototype.getAttribute;
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
    isOwn: (el) => isOwnElementId(getAttribute.call(el, "id")),
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

/** How many reads' numberings the content script keeps: the one the panel's
 *  tree came from, a newer one whose tree hasn't reached the panel yet, and
 *  one more for a read whose tree was never used (its walks disagreed, or it
 *  failed after numbering). */
export const KEPT_PAGE_KEY_READS = 3;
/** How far a focus report climbs for numbered elements above the focused one. */
const MAX_CLIMB = 256;

/** The content script's numberings of the page, by read. */
export class PageKeySnapshots {
  private reads: Array<{ readId: string; keys: WeakMap<Element, number> }> = [];

  /** `parentOf` is the climb a focus report takes: core's `renderingParent`,
   *  which leaves a shadow root for its host. */
  constructor(
    private readonly walker: PageKeyWalker<Element>,
    private readonly parentOf: (el: Element) => Element | null,
  ) {}

  /** Number the page under `root` for read `readId`, replacing an earlier
   *  numbering under the same id: a read retried after the debugger dropped
   *  numbers again. */
  take(readId: string, root: Element): PageKeyDigest {
    const keys = new WeakMap<Element, number>();
    const digest = walkPageKeys(root, this.walker, (el, key) =>
      keys.set(el, key),
    );
    this.reads = [
      ...this.reads.filter((read) => read.readId !== readId),
      { readId, keys },
    ].slice(-KEPT_PAGE_KEY_READS);
    return digest;
  }

  /**
   * For each read kept, the numbers of `el` and of each numbered element
   * above it, nearest first: the panel takes the first that names a row of
   * its tree. An element added since the read has no number, and reports
   * those above it. `undefined` when no read numbered any of them.
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
      if (chain.length > 0) (out ??= {})[readId] = chain;
    }
    return out;
  }
}
