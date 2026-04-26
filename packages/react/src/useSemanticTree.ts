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
 * Subscribe to a live Semantic Navigator tree rooted at `ref.current`.
 *
 * Re-renders on every debounced DOM mutation inside the root, so the
 * returned {@link ExtractionResult} is always fresh. Uses
 * `useSyncExternalStore` so it is safe under React 18 concurrent rendering.
 *
 * Returns `null` before the first extraction completes (e.g. while the ref
 * is still empty).
 */
export function useSemanticTree(
  ref: { current: Element | null },
  options: UseSemanticTreeOptions = {},
): ExtractionResult | null {
  const { mode = "a11y", debounceMs = 300 } = options;

  // A per-mount store — we deliberately recreate it when `mode` or the ref'd
  // element changes, by re-running the effect below.
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
    const root = ref.current;
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
  }, [ref, mode, debounceMs]);

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
