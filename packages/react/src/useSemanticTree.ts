import {
  DomObserver,
  LiveTreeExtractor,
  type ExtractionResult,
  type TreeChange,
  type TreeViewMode,
} from "@real-a11y-dev/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export interface UseSemanticTreeOptions {
  /** `"a11y"` (default) or `"dom"`. */
  mode?: TreeViewMode;
  /** Debounce window for the underlying DomObserver. Default 300ms. */
  debounceMs?: number;
}

/**
 * The root to observe: the element itself, or a React ref object holding it.
 *
 * A ref is read after every commit of the component that passes it, so a root
 * that mounts later than that component, behind a loading state say, attaches
 * as soon as the component re-renders. Pass the **element** when the root can
 * mount or be replaced without that component re-rendering, such as inside a
 * child with state of its own — e.g. from a callback ref stored in state:
 *
 * ```tsx
 * const [root, setRoot] = useState<HTMLElement | null>(null);
 * const tree = useSemanticTree(root);
 * return <main ref={setRoot}>…</main>;
 * ```
 *
 * An element changes identity when it is created or swapped, and setting it
 * re-renders whatever holds the state, so the observer re-attaches. A ref
 * OBJECT is stable by design, so React cannot notify anything when
 * `ref.current` changes: the change is seen the next time the component that
 * passes the ref commits, and not before.
 */
export type SemanticTreeTarget = Element | { current: Element | null } | null;

/**
 * Whether `target` is an element rather than a ref holding one. Asked through
 * `nodeType`, which no ref has, rather than `current`, which a custom element
 * can define for itself. `in` reads no value, so a `<form>` whose control is
 * named `nodeType` still answers, and unlike `instanceof Element` it holds for
 * an element from another frame.
 */
function isElement(
  target: Element | { current: Element | null },
): target is Element {
  return "nodeType" in target;
}

/**
 * The element `target` names, for an effect to observe. An element is used as
 * it is. A ref's `.current` attaches during a commit, after render has run, so
 * a read while rendering, or an effect that depends on the ref, misses a root
 * that mounts later than the caller: it is read after every commit instead,
 * and the element kept in state.
 *
 * Keyed by the element, never by the ref object: a ref made anew on every
 * render (`createRef()` in a function component, `{ current: el }` inline)
 * still names the same element, so nothing observing it is rebuilt. The cost
 * is that a ref swapped for another names the old one's element until the
 * next commit.
 */
export function useTargetElement(target: SemanticTreeTarget): Element | null {
  // `!target`, not `=== null`: plain JS, or a `useState<HTMLElement>()`
  // passed through a cast, hands this `undefined`.
  const ref = !target || isElement(target) ? null : target;
  // A plain value, never an object built per read: React can replay an update
  // onto an older state, and a new object on every replay never settles, so
  // this effect, which runs after every commit, would loop. Seen in Next.js
  // dev; jsdom never replays it.
  const [fromRef, setFromRef] = useState<Element | null>(null);
  // No dependency list: this runs after every commit. It sets state only on a
  // change, because even setting the value state holds can cost the caller a
  // second render after a render an update caused.
  useEffect(() => {
    const current = ref ? ref.current : null;
    if (current !== fromRef) setFromRef(current);
  });
  if (!ref) return target ? (target as Element) : null;
  return fromRef;
}

/**
 * Subscribe to a live Semantic Navigator tree rooted at `target` — an element,
 * or a ref object holding one (see {@link SemanticTreeTarget}).
 *
 * Re-renders on every debounced DOM mutation inside the root, so the
 * returned {@link ExtractionResult} is always fresh. Uses
 * `useSyncExternalStore` so it is safe under React 18 concurrent rendering.
 *
 * Returns `null` before the first extraction completes (e.g. while the ref
 * is still empty).
 */
export function useSemanticTree(
  target: SemanticTreeTarget,
  options: UseSemanticTreeOptions = {},
): ExtractionResult | null {
  const { mode = "a11y", debounceMs = 300 } = options;
  const liveMode: "dom" | "a11y" = mode === "dom" ? "dom" : "a11y";
  const root = useTargetElement(target);

  // A per-mount store. It is created once and kept for the life of the
  // component; only the OBSERVER is torn down and recreated when the root
  // element, mode, or debounce window changes (see the effect below).
  const storeRef = useRef<{
    tree: ExtractionResult | null;
    listeners: Set<() => void>;
    observer: DomObserver | null;
  } | null>(null);
  const liveRef = useRef<LiveTreeExtractor | null>(null);

  if (!storeRef.current) {
    storeRef.current = { tree: null, listeners: new Set(), observer: null };
  }

  // Wire an observer that re-extracts on mutations and notifies React.
  useEffect(() => {
    const store = storeRef.current!;
    if (!root) {
      // The root went away (element unmounted, or a ref was cleared). The
      // store's tree is only ever written by `flush()` below, so returning
      // here without clearing would keep serving the tree we built for content
      // that is no longer on the page — `useActiveModal` would go on reporting
      // a dialog that has been removed. Drop it and notify so consumers see
      // `null`, matching the "null until the first extraction" contract.
      if (store.tree !== null) {
        store.tree = null;
        for (const l of store.listeners) l();
      }
      return;
    }

    liveRef.current = new LiveTreeExtractor(root, { mode: liveMode });

    const flush = (change?: TreeChange) => {
      store.tree = liveRef.current!.refresh(change);
      for (const l of store.listeners) l();
    };

    flush(); // initial
    store.observer = new DomObserver(root, flush, debounceMs);
    store.observer.start();

    return () => {
      store.observer?.stop();
      store.observer = null;
    };
    // `root` in the deps is what makes a REPLACED or LATE-MOUNTED root
    // re-attach: it is the element itself, whichever form `target` took, so it
    // changes with the node and the observer is rebuilt on the new one (see
    // useTargetElement for when a ref's change is seen).
  }, [root, mode, debounceMs]);

  return useSyncExternalStore(
    (onChange) => {
      const store = storeRef.current!;
      store.listeners.add(onChange);
      return () => store.listeners.delete(onChange);
    },
    () => storeRef.current!.tree,
    // Server snapshot — same as client since the hook has no meaningful SSR value.
    () => null,
  );
}
