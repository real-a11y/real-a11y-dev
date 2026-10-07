/**
 * Frames in a native tree: the id a node of an out-of-process frame carries,
 * and how a frame's nodes join the tree under its `Iframe` row. Pure — which
 * frames there are, and the CDP reads that find and read them, stay in each
 * transport (the extension's debugger mode reads them; `browser` still reads
 * the top frame only), so a transport that grows frames later shares the id
 * scheme and the graft rather than restating them.
 *
 * Backend node ids are unique within one renderer process, and restart in
 * every other. A same-process frame's nodes keep plain ids; a node of an
 * out-of-process frame carries that frame and the document it showed when
 * read: `ax-dom-8@<frameId>.<documentId>`. The document matters because a
 * frame keeps its id across a navigation, and a cross-site one starts a fresh
 * process whose backend ids name unrelated elements.
 *
 * @internal
 */

/** Chromium's roles for an `<iframe>` element's row. */
export function isNativeIframeRole(role: string): boolean {
  return role === "Iframe" || role === "IframePresentational";
}

/** How deep nested frames are followed, by a read or a pick: deep enough for
 *  any page built by hand, and a bound on one built to recurse. */
export const NATIVE_MAX_FRAME_DEPTH = 5;

/** The out-of-process frame a node lives in. */
export interface NativeFrameRef {
  frameId: string;
  /** The document (loader id) the frame showed when its node was read. */
  documentId?: string;
}

/** The id suffix a node of `frame` carries (`@<frameId>.<documentId>`), or
 *  `""` for a node of the top frame or a same-process one. */
export function nativeFrameSuffix(frame?: NativeFrameRef | null): string {
  if (!frame) return "";
  return frame.documentId === undefined
    ? `@${frame.frameId}`
    : `@${frame.frameId}.${frame.documentId}`;
}

/** The node id of the element `backendNodeId`, in `frame` if it lives in an
 *  out-of-process one — the one builder of the format. */
export function nativeNodeId(
  backendNodeId: number,
  frame?: NativeFrameRef | null,
): string {
  return `ax-dom-${backendNodeId}${nativeFrameSuffix(frame)}`;
}

/** Split a node id into the id its own document knows it by and the
 *  out-of-process frame it lives in, if any. */
export function splitNativeNodeId(nodeId: string): {
  localId: string;
  frame: NativeFrameRef | null;
} {
  const at = nodeId.indexOf("@");
  if (at < 0) return { localId: nodeId, frame: null };
  const rest = nodeId.slice(at + 1);
  const dot = rest.indexOf(".");
  return {
    localId: nodeId.slice(0, at),
    frame:
      dot < 0
        ? { frameId: rest }
        : { frameId: rest.slice(0, dot), documentId: rest.slice(dot + 1) },
  };
}

/** The node shape the graft reads and writes. */
export interface NativeGraftNode {
  id: string;
  childIds: string[];
  depth: number;
  controls?: string[];
}

/** `node` with every id it holds suffixed by `suffix` — a frame's own
 *  ({@link nativeFrameSuffix}), carried down to the frames inside it. */
export function withNativeIdSuffix<T extends NativeGraftNode>(
  node: T,
  suffix: string,
): T {
  if (suffix === "") return node;
  return {
    ...node,
    id: `${node.id}${suffix}`,
    childIds: node.childIds.map((id) => `${id}${suffix}`),
    ...(node.controls
      ? { controls: node.controls.map((id) => `${id}${suffix}`) }
      : {}),
  };
}

/**
 * Put a frame's nodes under its `Iframe` row (`ownerId`): the frame's
 * top-level nodes become the row's children, and every node goes one level
 * deeper than the row, right after it in document order. Skipped, returning
 * false, when the row isn't in `nodes` or already has content, or the frame
 * has none; the row then shows as embedded. Mutates `nodes`.
 */
export function graftNativeFrame<T extends NativeGraftNode>(
  nodes: T[],
  ownerId: string,
  frameNodes: readonly T[],
): boolean {
  const at = nodes.findIndex((n) => n.id === ownerId);
  const owner = nodes[at];
  if (!owner || owner.childIds.length > 0 || frameNodes.length === 0) {
    return false;
  }
  const inFrame = new Set<string>();
  for (const n of frameNodes) for (const c of n.childIds) inFrame.add(c);
  owner.childIds = frameNodes
    .filter((n) => !inFrame.has(n.id))
    .map((n) => n.id);
  const shift = owner.depth + 1;
  nodes.splice(
    at + 1,
    0,
    ...frameNodes.map((n) => ({ ...n, depth: n.depth + shift })),
  );
  return true;
}
