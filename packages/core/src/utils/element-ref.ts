/**
 * GC-safe element reference map.
 * Uses WeakRef so DOM elements can be garbage collected
 * even if the tree store still holds a reference to the node ID.
 */
export class ElementRefMap {
  private refs = new Map<string, WeakRef<Element>>();
  private reverseRefs = new WeakMap<Element, string>();

  set(id: string, element: Element): void {
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
  }

  has(id: string): boolean {
    return this.get(id) !== undefined;
  }
}
