/**
 * An index of the id references in one tree, built with a single scan.
 *
 * Naming a control from its `<label for>` asks "which label in this tree
 * points at that id?". Answering with a query per element rescans the tree each
 * time, so a long form with a label for every field cost O(fields × page). This
 * indexes the `label[for]` elements once per tree and per extraction, and each
 * question becomes a map lookup.
 *
 * The index is keyed by the extraction's own style cache — a `WeakMap` created
 * fresh for every `extractDomTree` call — so it lives exactly as long as one
 * extraction and is never shared with the next one: the page changes in between.
 * It is deliberately not module-level state that outlives a call, which would
 * break across the several copies of `core` a page can load. A caller with no
 * cache (the public single-name entry points) gets an index for that call only.
 */
import {
  safeGetAttribute,
  safeQuerySelectorAll,
  safeTagName,
} from "./clobber-safe.js";

export interface ScopeReferenceIndex {
  /** `for` value → the first `<label for>` in this tree that carries it. */
  labelFor: Map<string, Element>;
}

type ScopeNode = Document | ShadowRoot | Element;

const perExtraction = new WeakMap<object, WeakMap<Node, ScopeReferenceIndex>>();

function build(scope: ScopeNode): ScopeReferenceIndex {
  const index: ScopeReferenceIndex = {
    labelFor: new Map(),
  };
  // One scan, in tree order, exactly the tree the per-element queries searched:
  // `scope` itself is not a candidate and a shadow root's contents are its own.
  // The reads go through the prototype, so a `<form>` holding
  // `<input name="getAttribute">` or an `<img name="querySelectorAll">` on the
  // document cannot make the index guess.
  for (const el of safeQuerySelectorAll(scope, "label[for]")) {
    if (safeTagName(el) !== "label") continue;
    const forId = safeGetAttribute(el, "for");
    if (forId && !index.labelFor.has(forId)) index.labelFor.set(forId, el);
  }
  return index;
}

/**
 * The reference index of `scope`, built on first use for this extraction.
 *
 * @internal
 */
export function scopeReferenceIndex(
  extraction: object | null | undefined,
  scope: ScopeNode,
): ScopeReferenceIndex {
  if (!extraction) return build(scope);
  let scopes = perExtraction.get(extraction);
  if (!scopes) {
    scopes = new WeakMap();
    perExtraction.set(extraction, scopes);
  }
  let index = scopes.get(scope);
  if (!index) {
    index = build(scope);
    scopes.set(scope, index);
  }
  return index;
}
