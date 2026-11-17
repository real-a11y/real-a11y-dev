/**
 * Which frames a native read follows, and the CDP reads that find them. Split
 * out of `native-tree.ts`, which grafts what this returns under the frames'
 * rows (core's `graftNativeFrame`).
 */

import {
  isNativeIframeRole,
  NATIVE_MAX_FRAME_DEPTH,
  type RawAXNameNode as RawAXNode,
} from "@real-a11y-dev/core";
import type { CDPSession } from "playwright";

import type { NativeDomInfo } from "./native-sensitivity.js";

/**
 * One frame's `Accessibility.getFullAXTree` payload, and the row of the
 * `<iframe>` element that shows it: `ax-dom-<backendNodeId>` of the frame's
 * owner (`DOM.getFrameOwner`). The frame's nodes go under that row, one level
 * deeper — core's `graftNativeFrame`.
 *
 * A frame in the page's own renderer process shares the page's ids, which
 * are unique within that process, and the page's DOM walk. A frame Chromium
 * runs in another process (a cross-site or sandboxed `<iframe>` under site
 * isolation) is read in a session of its own: backend ids restart in every
 * process, so it carries that process's DOM walk (`enrichment`) and the
 * suffix its rows' ids take (`suffix`, core's `nativeFrameSuffix`:
 * `@<frameId>.<documentId>`), as does a same-process frame inside it.
 * `ownerId` is the row's id as the tree has it, suffix included.
 */
export interface NativeFramePayload {
  ownerId: string;
  rawNodes: RawAXNode[];
  /** The DOM walk of the process this frame runs in; absent: the page's. */
  enrichment?: ReadonlyMap<number, NativeDomInfo>;
  /** The id suffix of that process's rows; absent or `""`: plain ids. */
  suffix?: string;
}

/** The most frames one read follows, however they nest and in however many
 *  processes: a page of dozens of ad frames costs a full read of each. Rows
 *  past it stay empty. The extension's native read stops at the same count. */
export const MAX_FRAMES_PER_READ = 20;

/** What is left of a read's {@link MAX_FRAMES_PER_READ}, shared by every
 *  session the read goes through. */
export interface FrameBudget {
  left: number;
}

/** The backend ids of the `Iframe` rows in `nodes` that Chromium doesn't
 *  ignore: the rows a frame can go under. */
export function iframeRowIds(nodes: readonly RawAXNode[]): number[] {
  const out: number[] = [];
  for (const n of nodes) {
    if (
      n.ignored !== true &&
      typeof n.backendDOMNodeId === "number" &&
      isNativeIframeRole(n.role?.value ?? "")
    ) {
      out.push(n.backendDOMNodeId);
    }
  }
  return out;
}

interface FrameTreeNode {
  frame: { id: string; url?: string };
  childFrames?: FrameTreeNode[];
}

/**
 * Whether a frame showing `url` may be read on a session pinned to
 * `pinned` (see `NativeTreeOptions.frameOrigins`): its document came from
 * one of those origins, or it has no origin of its own and holds its
 * parent's markup (`about:srcdoc`, `about:blank`, `data:`), the parent
 * having been read under the same pin. Anything else, an unparseable URL
 * included, is not read.
 */
export function frameFromPinnedOrigin(
  url: string | undefined,
  pinned: ReadonlySet<string>,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url ?? "");
  } catch {
    return false;
  }
  if (parsed.origin !== "null") return pinned.has(parsed.origin);
  return parsed.protocol === "about:" || parsed.protocol === "data:";
}

/**
 * Every frame of `client`'s process whose row the tree keeps, owner
 * before the frames inside it, depth first. A frame is read only when its
 * `<iframe>` has an `Iframe` row Chromium does not ignore, in the top
 * document or a frame read before it: a hidden ad frame has none, and would
 * be read in full only to be thrown away. Bounded by
 * {@link NATIVE_MAX_FRAME_DEPTH} and {@link MAX_FRAMES_PER_READ}. A frame
 * that fails to read (removed or navigated mid-read) is left out; its row
 * stays empty and the rest of the tree still reads. With `frameOrigins` (a
 * pinned session), a frame from any other origin is left out too, with the
 * frames inside it ({@link frameFromPinnedOrigin}).
 *
 * @internal Exported for its unit tests.
 */
export async function readFrames(
  client: CDPSession,
  topNodes: readonly RawAXNode[],
  {
    frameOrigins,
    budget = { left: MAX_FRAMES_PER_READ },
    startDepth = 0,
  }: {
    frameOrigins?: readonly string[];
    budget?: FrameBudget;
    /** How deep `client`'s own document is: 0 for the page's. */
    startDepth?: number;
  } = {},
): Promise<NativeFramePayload[]> {
  const pinned = frameOrigins ? new Set(frameOrigins) : null;
  const tree = (await client
    .send("Page.getFrameTree")
    .catch(() => undefined)) as { frameTree?: FrameTreeNode } | undefined;
  if (!tree?.frameTree) return [];

  const rows = new Set<number>(iframeRowIds(topNodes));
  const out: NativeFramePayload[] = [];
  const walk = async (node: FrameTreeNode, depth: number): Promise<void> => {
    if (depth >= NATIVE_MAX_FRAME_DEPTH) return;
    const children = (node.childFrames ?? []).filter(
      (child) => !pinned || frameFromPinnedOrigin(child.frame.url, pinned),
    );
    // One round trip for every sibling's owner; the reads stay in order.
    const owners = await Promise.all(
      children.map(
        (child) =>
          client
            .send("DOM.getFrameOwner", { frameId: child.frame.id })
            .catch(() => undefined) as Promise<
            { backendNodeId?: number } | undefined
          >,
      ),
    );
    for (const [i, child] of children.entries()) {
      if (budget.left <= 0) return;
      const ownerBackendId = owners[i]?.backendNodeId;
      if (typeof ownerBackendId !== "number" || !rows.has(ownerBackendId)) {
        continue;
      }
      budget.left--;
      const read = (await client
        .send("Accessibility.getFullAXTree", { frameId: child.frame.id })
        .catch(() => undefined)) as { nodes?: RawAXNode[] } | undefined;
      if (!read?.nodes?.length) continue;
      for (const id of iframeRowIds(read.nodes)) rows.add(id);
      out.push({ ownerId: `ax-dom-${ownerBackendId}`, rawNodes: read.nodes });
      await walk(child, depth + 1);
    }
  };
  await walk(tree.frameTree, startDepth);
  return out;
}
