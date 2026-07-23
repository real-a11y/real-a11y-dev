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
 * Normalization comes from `@real-a11y-dev/core`'s shared vocabulary module
 * (R4 consolidation, merged in #205) — this file adds only transport plumbing.
 * Being bundled into an MV3 service worker, it also proves the module's
 * "pure, importable from workers" claim, and picks up #205's childIds-driven
 * sibling ordering (the flat-list ordering the original spike copy had was
 * the drift bug that motivated consolidation).
 */

import {
  normalizeNativeAX,
  serializeNativeAX,
  type NativeAXNode,
  type RawNativeAXNode,
} from "@real-a11y-dev/core";

export type RawAXNode = RawNativeAXNode;
export type NativeNode = NativeAXNode;

export interface CdpTransport {
  send<T = unknown>(method: string, params?: object): Promise<T>;
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
  const nodes = normalizeNativeAX(full.nodes);
  return {
    nodes,
    serialized: serializeNativeAX(nodes),
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
