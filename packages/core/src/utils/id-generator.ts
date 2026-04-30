let counter = 0;
const idMap = new WeakMap<Node, string>();

/**
 * Get or create a stable unique ID for a DOM node.
 *
 * @internal The id format (`sn-<n>`) is an implementation detail — consumers
 * should treat returned strings as opaque and not parse them.
 */
export function getNodeId(node: Node): string {
  let id = idMap.get(node);
  if (!id) {
    id = `sn-${counter++}`;
    idMap.set(node, id);
  }
  return id;
}

/**
 * Reset the global node-id counter. Exposed for tests that need
 * deterministic ids across runs.
 *
 * @internal
 */
export function resetIdCounter(): void {
  counter = 0;
}
