import { realmSingleton } from "./realm-singleton.js";

/**
 * The counter and the map are ONE object on purpose: the counter's guarantee is
 * "no id handed out twice", which only holds relative to the map it fills. Two
 * copies of this module with a counter each hand `sn-0` to two different nodes,
 * and every id-keyed lookup after that resolves to whichever node the reader's
 * copy happens to know about. Keeping them in a single realm-wide slot means
 * two copies cannot disagree about either half.
 *
 * `let counter` could not be shared by reference, which is why this is a field
 * on a shared object rather than a module variable.
 */
interface IdState {
  counter: number;
  ids: WeakMap<Node, string>;
}

function state(): IdState {
  return realmSingleton<IdState>("id-generator", () => ({
    counter: 0,
    ids: new WeakMap<Node, string>(),
  }));
}

/**
 * Get or create a stable unique ID for a DOM node.
 *
 * @internal The id format (`sn-<n>`) is an implementation detail — consumers
 * should treat returned strings as opaque and not parse them.
 */
export function getNodeId(node: Node): string {
  const s = state();
  let id = s.ids.get(node);
  if (!id) {
    id = `sn-${s.counter++}`;
    s.ids.set(node, id);
  }
  return id;
}

/**
 * Reset the global node-id counter. Exposed for tests that need
 * deterministic ids across runs.
 *
 * Resets the counter only — the node→id map is deliberately kept. Clearing it
 * would let a node that already has `sn-7` be handed `sn-0` on its next
 * extraction while `sn-7` still points at it in the element ref map.
 *
 * @internal
 */
export function resetIdCounter(): void {
  state().counter = 0;
}
