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

/**
 * One frame's `Accessibility.getFullAXTree` payload, and the row of the
 * `<iframe>` element that shows it: `ax-dom-<backendNodeId>` of the frame's
 * owner (`DOM.getFrameOwner`). The frame's nodes go under that row, one level
 * deeper — core's `graftNativeFrame`.
 *
 * Only frames in the page's own renderer process are read today: their
 * backend and AX node ids are unique within that process, so their nodes keep
 * plain ids and share the page's DOM walk. A frame Chromium runs in another
 * process (a cross-site or sandboxed `<iframe>` under site isolation) has a
 * session of its own and is not in the page's frame tree; its row stays
 * empty.
 */
export interface NativeFramePayload {
  ownerId: string;
  rawNodes: RawAXNode[];
}

/** The most frames one read follows, however they nest: a page of dozens of
 *  ad frames costs a full read of each. Rows past it stay empty. The
 *  extension's native read stops at the same count. */
const MAX_FRAMES_PER_READ = 20;

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
 * Every frame of the page's own process whose row the tree keeps, owner
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
  frameOrigins?: readonly string[],
): Promise<NativeFramePayload[]> {
  const pinned = frameOrigins ? new Set(frameOrigins) : null;
  const tree = (await client
    .send("Page.getFrameTree")
    .catch(() => undefined)) as { frameTree?: FrameTreeNode } | undefined;
  if (!tree?.frameTree) return [];

  const rows = new Set<number>();
  const addRows = (nodes: readonly RawAXNode[]): void => {
    for (const n of nodes) {
      if (
        n.ignored !== true &&
        typeof n.backendDOMNodeId === "number" &&
        isNativeIframeRole(n.role?.value ?? "")
      ) {
        rows.add(n.backendDOMNodeId);
      }
    }
  };
  addRows(topNodes);

  const out: NativeFramePayload[] = [];
  let left = MAX_FRAMES_PER_READ;
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
      if (left <= 0) return;
      const ownerBackendId = owners[i]?.backendNodeId;
      if (typeof ownerBackendId !== "number" || !rows.has(ownerBackendId)) {
        continue;
      }
      left--;
      const read = (await client
        .send("Accessibility.getFullAXTree", { frameId: child.frame.id })
        .catch(() => undefined)) as { nodes?: RawAXNode[] } | undefined;
      if (!read?.nodes?.length) continue;
      addRows(read.nodes);
      out.push({ ownerId: `ax-dom-${ownerBackendId}`, rawNodes: read.nodes });
      await walk(child, depth + 1);
    }
  };
  await walk(tree.frameTree, 0);
  return out;
}
