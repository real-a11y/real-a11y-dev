let counter = 0;
const idMap = new WeakMap<Node, string>();

/** Get or create a stable unique ID for a DOM node */
export function getNodeId(node: Node): string {
  let id = idMap.get(node);
  if (!id) {
    id = `sn-${counter++}`;
    idMap.set(node, id);
  }
  return id;
}

/** Reset the counter (for testing) */
export function resetIdCounter(): void {
  counter = 0;
}
