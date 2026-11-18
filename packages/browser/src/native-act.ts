/**
 * Which CDP session an action on a native node runs over.
 *
 * A node of the page, or of a frame in the page's own renderer process, resolves
 * through the page's session. A node of a frame Chromium runs in another process
 * (its id carries the frame: `ax-dom-8@<frameId>.<documentId>`) resolves only
 * through that frame's session, which also serves the same-process frames inside
 * it. Backend ids restart in every process, so the same number names an unrelated
 * element anywhere else: the action either reaches the session that read the node
 * or it doesn't run.
 *
 * A frame keeps its id across a navigation, so the document is checked too: the
 * frame must still show the document the node was read from. On a session pinned
 * to origins, the frame must be one a read would have shown.
 */

import {
  splitNativeNodeId,
  type ActionRequest,
  type ActionResult,
  type NativeFrameRef,
} from "@real-a11y-dev/core";
import type { CDPSession, Frame, Page } from "playwright";

import { CdpActionBackend } from "./cdp-action-backend.js";
import { frameFromPinnedOrigin, type CdpFrame } from "./native-frames.js";
import type { NativeTreeOptions } from "./native-sensitivity.js";

/** What became of the frame a node was read from. */
type FrameCheck = "current" | "stale" | "not-allowed";

/** Whether every frame around `frame`, the page's own aside, is one a session
 *  pinned to `pinned` reads: a read skips whatever sits inside one that isn't. */
function framesAroundArePinned(
  frame: Frame,
  pinned: ReadonlySet<string>,
): boolean {
  for (
    let cur = frame.parentFrame();
    cur?.parentFrame();
    cur = cur.parentFrame()
  ) {
    if (!frameFromPinnedOrigin(cur.url(), pinned)) return false;
  }
  return true;
}

/** `null` when `session` is on some other frame than `ref`. */
async function checkFrame(
  session: CDPSession,
  frame: Frame,
  ref: NativeFrameRef,
  pinned: ReadonlySet<string> | null,
): Promise<FrameCheck | null> {
  const { frameTree } = (await session.send("Page.getFrameTree")) as {
    frameTree: { frame: CdpFrame & { loaderId?: string } };
  };
  const shown = frameTree.frame;
  if (shown.id !== ref.frameId) return null;
  if (
    pinned &&
    !(
      frameFromPinnedOrigin(shown, pinned) &&
      framesAroundArePinned(frame, pinned)
    )
  ) {
    return "not-allowed";
  }
  return shown.loaderId === ref.documentId ? "current" : "stale";
}

/**
 * A session on the out-of-process frame `ref`, left open for the caller to
 * detach, or why there is none. `newCDPSession` refuses a frame that shares its
 * parent's process, and a frame that fails to answer is on its way out.
 */
async function openFrameSession(
  page: Page,
  ref: NativeFrameRef,
  pinned: ReadonlySet<string> | null,
): Promise<CDPSession | Exclude<FrameCheck, "current">> {
  const main = page.mainFrame();
  for (const frame of page.frames()) {
    if (frame === main) continue;
    const session = await page
      .context()
      .newCDPSession(frame)
      .catch(() => null);
    if (!session) continue;
    const check = await checkFrame(session, frame, ref, pinned).catch(
      () => null,
    );
    if (check === "current") return session;
    await session.detach().catch(() => {});
    if (check) return check;
  }
  return "stale";
}

async function dispatchOver(
  session: CDPSession,
  request: ActionRequest,
  frame: NativeFrameRef | null,
): Promise<ActionResult> {
  try {
    return await new CdpActionBackend(session, frame).dispatch(request);
  } finally {
    await session.detach().catch(() => {});
  }
}

/**
 * Dispatch `request` against its node, over the session of the process the node
 * lives in. A node whose frame navigated or is gone, or a frame a pinned session
 * doesn't read, is refused without touching the page.
 */
export async function actOnNativeNode(
  page: Page,
  request: ActionRequest,
  { frameOrigins }: Pick<NativeTreeOptions, "frameOrigins"> = {},
): Promise<ActionResult> {
  const { frame } = splitNativeNodeId(request.nodeId);
  if (!frame) {
    const session = await page.context().newCDPSession(page);
    return dispatchOver(session, request, null);
  }
  const pinned = frameOrigins ? new Set(frameOrigins) : null;
  const session = await openFrameSession(page, frame, pinned);
  if (session === "stale") {
    return {
      success: false,
      // Worded like the backend's own stale id: the surfaces read this phrase.
      error: `could not resolve node "${request.nodeId}" to a live DOM element — its frame navigated or was removed; re-read the tree and retry`,
    };
  }
  if (session === "not-allowed") {
    return {
      success: false,
      error: `node "${request.nodeId}" is inside a frame from an origin this session is not allowed to read`,
    };
  }
  return dispatchOver(session, request, frame);
}
