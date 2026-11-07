import type { CDPSession } from "playwright";

export interface DomNode {
  /** Present on a `DOM.getFlattenedDocument` entry, which links by id. */
  nodeId?: number;
  parentId?: number;
  backendNodeId?: number;
  nodeName?: string;
  nodeType?: number;
  attributes?: string[];
  children?: DomNode[];
  contentDocument?: DomNode;
  shadowRoots?: DomNode[];
  /** On a shadow root: `open`, `closed` or `user-agent`. */
  shadowRootType?: string;
  pseudoElements?: DomNode[];
}

/**
 * The document as one nested {@link DomNode}. `DOM.getDocument` answers with the
 * whole tree nested two JSON levels per DOM level, and Chromium's CDP writer
 * stops at 300, so it rejects ("CBOR: stack limit exceeded") for a page nested
 * about 150 levels deep, however small. `DOM.getFlattenedDocument` returns the
 * same nodes as an array, so it has no depth limit; it is deprecated, so the
 * nested read stays as the fallback should a Chromium drop it.
 */
export async function readDomRoot(client: CDPSession): Promise<DomNode> {
  try {
    // The flat command, unlike the nested one, needs the DOM agent enabled.
    await client.send("DOM.enable");
    const { nodes } = (await client.send("DOM.getFlattenedDocument", {
      depth: -1,
      pierce: true,
    })) as { nodes: DomNode[] };
    return nestFlatDocument(nodes);
  } catch (flatError) {
    try {
      const { root } = (await client.send("DOM.getDocument", {
        depth: -1,
        pierce: true,
      })) as { root: DomNode };
      return root;
    } catch {
      // Both failed: report the flat read's error, the one that is not just
      // the nested read's depth limit.
      throw flatError;
    }
  }
}

/**
 * Rebuild the nested tree the walk reads from `DOM.getFlattenedDocument`'s
 * array. Each node carries its `parentId` and an empty `children`; the array is
 * post-order, so appending in array order keeps sibling order. Shadow roots,
 * `contentDocument`s and pseudo-elements come nested on their owner (shallow,
 * with empty `children`) rather than as array entries, and their own children
 * name them as `parentId`, so those stubs are indexed too. Throws on a payload
 * with no root, so the caller falls back to the nested read.
 */
export function nestFlatDocument(nodes: DomNode[]): DomNode {
  const byId = new Map<number, DomNode>();
  const register = (n: DomNode): void => {
    if (typeof n.nodeId !== "number" || byId.has(n.nodeId)) return;
    n.children = [];
    byId.set(n.nodeId, n);
  };
  for (const n of nodes) {
    register(n);
    for (const sub of n.shadowRoots ?? []) register(sub);
    if (n.contentDocument) register(n.contentDocument);
    for (const pseudo of n.pseudoElements ?? []) register(pseudo);
  }
  let root: DomNode | undefined;
  for (const n of nodes) {
    const parent = n.parentId === undefined ? undefined : byId.get(n.parentId);
    if (parent) parent.children!.push(n);
    else root ??= n;
  }
  if (!root) throw new Error("DOM.getFlattenedDocument returned no root");
  return root;
}

/** Read one attribute out of CDP's flat `[name, value, name, value, …]`. */
export function attributeOf(node: DomNode, want: string): string | null {
  const attrs = node.attributes ?? [];
  for (let i = 0; i + 1 < attrs.length; i += 2) {
    if (attrs[i] === want) return attrs[i + 1];
  }
  return null;
}
