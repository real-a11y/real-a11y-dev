/**
 * Entry count that triggers the next sweep. Small maps never sweep; the
 * threshold then tracks the live set (see `sweep`), so the amortized cost of
 * a `set` stays constant no matter how many elements have come and gone.
 */
const MIN_SWEEP_THRESHOLD = 64;

/**
 * Shape tag for the realm-wide instance of this class — see
 * `realm-singleton.ts`. It lives HERE, next to the contract it describes, so
 * that changing the class and forgetting the tag takes deliberate effort
 * rather than remembering a note in another file.
 *
 * Bump it whenever a caller could tell the difference: a method added, removed
 * or renamed, or a change to what an existing one returns. Two engine versions
 * that disagree then keep separate maps instead of one version calling a method
 * the other never had.
 */
export const ELEMENT_REF_MAP_SHAPE = "ElementRefMap@1";

/**
 * GC-safe element reference map.
 * Uses WeakRef so DOM elements can be garbage collected
 * even if the tree store still holds a reference to the node ID.
 */
export class ElementRefMap {
  private refs = new Map<string, WeakRef<Element>>();
  private reverseRefs = new WeakMap<Element, string>();
  private sweepAt = MIN_SWEEP_THRESHOLD;

  set(id: string, element: Element): void {
    // The WeakRef lets the element go, but its Map entry has to be dropped by
    // hand. `get` only ever clears the one id it was asked for, and the ids of
    // removed elements are precisely the ones nobody asks for again — so
    // without this sweep an SPA that churns through DOM accumulates a dead
    // entry per element it has ever rendered, for the life of the tab.
    if (this.refs.size >= this.sweepAt) this.sweep();

    this.refs.set(id, new WeakRef(element));
    this.reverseRefs.set(element, id);
  }

  get(id: string): Element | undefined {
    const ref = this.refs.get(id);
    if (!ref) return undefined;

    const element = ref.deref();
    if (!element) {
      this.refs.delete(id);
      return undefined;
    }

    return element;
  }

  delete(id: string): void {
    this.refs.delete(id);
  }

  /** Find node ID for a given element (reverse lookup) */
  findId(element: Element): string | undefined {
    return this.reverseRefs.get(element);
  }

  clear(): void {
    this.refs.clear();
    this.reverseRefs = new WeakMap();
    this.sweepAt = MIN_SWEEP_THRESHOLD;
  }

  has(id: string): boolean {
    return this.get(id) !== undefined;
  }

  /**
   * Drop every entry whose element has been collected, then set the next
   * threshold at twice what survived. Sweeping is O(entries), but doubling
   * puts the next sweep at least `size` insertions away, so the per-`set`
   * cost stays amortized O(1).
   *
   * Engines clear WeakRefs lazily, so a burst of churn with no GC in between
   * finds nothing to drop and just raises the threshold. That is inherent to
   * WeakRef — the entries become collectable, and the next sweep after a GC
   * takes them.
   */
  private sweep(): void {
    for (const [id, ref] of this.refs) {
      if (!ref.deref()) this.refs.delete(id);
    }
    this.sweepAt = Math.max(MIN_SWEEP_THRESHOLD, this.refs.size * 2);
  }
}
