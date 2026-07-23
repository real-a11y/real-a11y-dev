/**
 * SPIKE — transport-agnostic native-tree core (extension chrome.debugger).
 *
 * The point of this module: prove the "third CDP transport" cost from RFC v3
 * is avoidable by construction. Everything that reads/normalizes/acts on the
 * native AX tree is written against the minimal `CdpTransport` interface —
 * the SAME code runs over `chrome.debugger.sendCommand` (extension service
 * worker) and Playwright's `CDPSession` (Node). The spike test asserts both
 * produce identical output on one fixture.
 *
 * Vocabulary (drop-list / role map / StaticText name promotion) is a copy of
 * the desktop-navigator spike's — the third copy in tree, which is exactly
 * finding R4 in native-tree-v3.md: product code must consolidate these into
 * one versioned module in `browser` (pure, so this surface can import it too).
 */

export interface CdpTransport {
  send<T = unknown>(method: string, params?: object): Promise<T>;
}

export interface RawAXNode {
  nodeId: string;
  parentId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
}

export interface NativeNode {
  id: string;
  role: string;
  name: string;
  depth: number;
  backendDOMNodeId: number | null;
  childIds: string[];
}

const DROP = new Set([
  "StaticText",
  "InlineTextBox",
  "LineBreak",
  "LabelText",
  "ListMarker",
  "generic",
  "none",
  "presentation",
  "RootWebArea",
]);

const ROLE_MAP: Record<string, string> = {
  Video: "video",
  Audio: "audio",
  image: "img",
};

export function normalize(axNodes: RawAXNode[]): NativeNode[] {
  const byId = new Map(axNodes.map((n) => [n.nodeId, n]));
  const keep = new Set<string>();
  for (const n of axNodes) {
    const role = n.role?.value ?? "";
    if (n.ignored || !role || DROP.has(role)) continue;
    keep.add(n.nodeId);
  }

  const keptParent = (id: string): string | null => {
    let cur = byId.get(id)?.parentId;
    while (cur) {
      if (keep.has(cur)) return cur;
      cur = byId.get(cur)?.parentId;
    }
    return null;
  };

  const childrenOf = new Map<string | null, string[]>();
  for (const id of keep) {
    const p = keptParent(id);
    const list = childrenOf.get(p) ?? [];
    list.push(id);
    childrenOf.set(p, list);
  }

  const idOf = (ax: RawAXNode): string =>
    typeof ax.backendDOMNodeId === "number"
      ? `ax-dom-${ax.backendDOMNodeId}`
      : `ax-${ax.nodeId}`;

  const out: NativeNode[] = [];
  const walk = (axId: string, depth: number) => {
    const ax = byId.get(axId)!;
    const raw = ax.role?.value ?? "generic";
    let name = (ax.name?.value ?? "").replace(/\s+/g, " ").trim();
    if (!name) {
      for (const cid of ax.childIds ?? []) {
        const c = byId.get(cid);
        if (c?.role?.value === "StaticText") {
          const n = (c.name?.value ?? "").trim();
          if (n) {
            name = n;
            break;
          }
        }
      }
    }
    const childAx = childrenOf.get(axId) ?? [];
    out.push({
      id: idOf(ax),
      role: ROLE_MAP[raw] ?? raw,
      name,
      depth,
      backendDOMNodeId:
        typeof ax.backendDOMNodeId === "number" ? ax.backendDOMNodeId : null,
      childIds: childAx.map((c) => idOf(byId.get(c)!)),
    });
    for (const c of childAx) walk(c, depth + 1);
  };

  for (const root of childrenOf.get(null) ?? []) walk(root, 0);
  return out;
}

export function serializeNodes(nodes: NativeNode[]): string {
  return nodes
    .map((n) => {
      const label = n.name ? `${n.role} "${n.name}"` : n.role;
      return `${"  ".repeat(n.depth)}${label}`;
    })
    .join("\n");
}

export interface NativeTreeResult {
  nodes: NativeNode[];
  serialized: string;
  axNodeCount: number;
}

/** Read + normalize the full native AX tree over any CDP transport. */
export async function readNativeTree(
  transport: CdpTransport,
): Promise<NativeTreeResult> {
  await transport.send("Accessibility.enable");
  const full = await transport.send<{ nodes: RawAXNode[] }>(
    "Accessibility.getFullAXTree",
  );
  const nodes = normalize(full.nodes);
  return {
    nodes,
    serialized: serializeNodes(nodes),
    axNodeCount: full.nodes.length,
  };
}

export interface ClickResult {
  ok: boolean;
  /** Static reason strings only — never exception text (v3 R6 invariant). */
  error?: "no-backend-id" | "resolve-failed" | "call-failed";
}

/** Click the DOM element behind an AX node, over any CDP transport. */
export async function clickByBackendId(
  transport: CdpTransport,
  backendDOMNodeId: number | null,
): Promise<ClickResult> {
  if (typeof backendDOMNodeId !== "number") {
    return { ok: false, error: "no-backend-id" };
  }
  await transport.send("DOM.enable");
  await transport.send("DOM.getDocument", { depth: 0 });
  let objectId: string | undefined;
  try {
    const resolved = await transport.send<{ object?: { objectId?: string } }>(
      "DOM.resolveNode",
      { backendNodeId: backendDOMNodeId },
    );
    objectId = resolved.object?.objectId;
  } catch {
    return { ok: false, error: "resolve-failed" };
  }
  if (!objectId) return { ok: false, error: "resolve-failed" };
  try {
    await transport.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function () { if (typeof this.click === "function") this.click(); }`,
      returnByValue: true,
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "call-failed" };
  }
}

/** First normalized node matching role + optional name substring. */
export function findNode(
  nodes: NativeNode[],
  role: string,
  nameIncludes?: string,
): NativeNode | undefined {
  return nodes.find(
    (n) =>
      n.role === role &&
      (nameIncludes === undefined ||
        n.name.toLowerCase().includes(nameIncludes.toLowerCase())),
  );
}
