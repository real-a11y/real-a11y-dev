import {
  DomObserver,
  extractA11yTree,
  extractDomTree,
  type ExtractionResult,
  type TreeViewMode,
} from "@real-a11y-dev/core";
import { useEffect, useRef, useSyncExternalStore } from "react";

export interface UseSemanticTreeOptions {
  /** `"a11y"` (default) or `"dom"`. */
  mode?: TreeViewMode;
  /** Debounce window for the underlying DomObserver. Default 300ms. */
  debounceMs?: number;
}

/**
 * The root to observe: the element itself, or a React ref object holding it.
 *
 * Prefer passing the **element** when the root can mount later than this hook
 * or be replaced — e.g. from a callback ref stored in state:
 *
 * ```tsx
 * const [root, setRoot] = useState<HTMLElement | null>(null);
 * const tree = useSemanticTree(root);
 * return <main ref={setRoot}>…</main>;
 * ```
 *
 * An element changes identity when it is created or swapped, so the observer
 * re-attaches. A ref OBJECT is stable by design, so React cannot notify this
 * hook when `ref.current` changes — passing a ref only re-attaches when some
 * other state change re-renders the component.
 */
export type SemanticTreeTarget = Element | { current: Element | null } | null;

function resolveTarget(target: SemanticTreeTarget): Element | null {
  if (!target) return null;
  return "current" in target ? target.current : target;
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

  // A per-mount store. It is created once and kept for the life of the
  // component; only the OBSERVER is torn down and recreated when the root
  // element, mode, or debounce window changes (see the effect below).
  const storeRef = useRef<{
    tree: ExtractionResult | null;
    listeners: Set<() => void>;
    observer: DomObserver | null;
  } | null>(null);

  if (!storeRef.current) {
    storeRef.current = { tree: null, listeners: new Set(), observer: null };
  }

  // Wire an observer that re-extracts on mutations and notifies React.
  useEffect(() => {
    const store = storeRef.current!;
    // Resolve HERE, not during render: a ref's `.current` is populated after
    // the commit, so reading it during render would see `null` on first paint.
    const root = resolveTarget(target);
    if (!root) return;

    const extract = () =>
      mode === "dom" ? extractDomTree(root) : extractA11yTree(root);

    const flush = () => {
      store.tree = extract();
      for (const l of store.listeners) l();
    };

    flush(); // initial
    store.observer = new DomObserver(root, flush, debounceMs);
    store.observer.start();

    return () => {
      store.observer?.stop();
      store.observer = null;
    };
    // `target` in the deps is what makes a REPLACED or LATE-MOUNTED root
    // re-attach: when an element is passed, its identity changes and the
    // observer is rebuilt on the new node. (A ref object is stable by design,
    // so React cannot signal a `.current` change — see SemanticTreeTarget.)
  }, [target, mode, debounceMs]);

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
