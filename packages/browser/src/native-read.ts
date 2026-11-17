/**
 * The CDP reads a native tree is built from: the page's accessibility tree
 * and DOM, and every frame's, in whichever renderer process Chromium runs it.
 * `native-tree.ts` assembles what this returns.
 *
 * A frame in the page's own process is read through the page's session
 * (`readFrames`). Under site isolation a cross-site or sandboxed `<iframe>`
 * runs in another process: it is absent from the page's frame tree, and
 * only a session of its own reads it. Playwright attaches to every such
 * frame already, launched or over `--cdp`, and `newCDPSession(frame)` opens a
 * session on it (refusing a frame that shares its parent's process). Backend
 * ids restart in every process, so each such frame brings its own DOM walk,
 * and its rows' ids carry the frame and its document (core's
 * `nativeFrameSuffix`).
 */

import {
  NATIVE_MAX_FRAME_DEPTH,
  nativeFrameSuffix,
  type RawAXNameNode as RawAXNode,
} from "@real-a11y-dev/core";
import type { CDPSession, Frame, Page } from "playwright";

import { enrichFromDom } from "./native-dom.js";
import { editableRootBackendIds } from "./native-editable.js";
import {
  frameFromPinnedOrigin,
  iframeRowIds,
  MAX_FRAMES_PER_READ,
  readFrames,
  type FrameBudget,
  type NativeFramePayload,
} from "./native-frames.js";
import type { NativeDomInfo, NativeTreeOptions } from "./native-sensitivity.js";

/** Everything a native tree is built from. */
export interface NativeRead {
  rawNodes: RawAXNode[];
  frames: NativeFramePayload[];
  enrichment: Map<number, NativeDomInfo>;
}

/** A renderer process the read went through: the page's, or an
 *  out-of-process frame's (with the same-process frames inside it). */
interface ProcessRead {
  client: CDPSession;
  suffix: string;
  enrichment: ReadonlyMap<number, NativeDomInfo>;
  /** Strict mode: backend ids below an editable region in this process. */
  inEditable: ReadonlySet<number>;
}

/** What every frame of one read shares: the rows a frame can go under
 *  (suffixed ids, across every document read so far), the read's options,
 *  and its frame budget. */
interface FrameReadState {
  rows: Set<string>;
  options: NativeTreeOptions;
  budget: FrameBudget;
}

/** The editable roots across `documents`, for the strict-mode DOM walk. */
function editableRootsOf(
  documents: readonly (readonly RawAXNode[])[],
  options: NativeTreeOptions,
): Set<number> {
  const roots = new Set<number>();
  if (options.redactInput !== true) return roots;
  for (const nodes of documents) {
    for (const id of editableRootBackendIds(nodes as RawAXNode[])) {
      roots.add(id);
    }
  }
  return roots;
}

/** How many frames down from the page's `frame` is: 0 for the page's own. */
function depthOf(frame: Frame): number {
  let depth = 0;
  for (let cur = frame.parentFrame(); cur; cur = cur.parentFrame()) depth++;
  return depth;
}

/**
 * Read `page` over `client`, its own session: the page's tree and its
 * same-process frames, one DOM walk, then every out-of-process frame
 * ({@link readRemoteFrames}). The page's frames are read before the walk so
 * that strict mode knows their editable regions.
 */
export async function readNative(
  page: Page,
  client: CDPSession,
  options: NativeTreeOptions,
): Promise<NativeRead> {
  await client.send("Accessibility.enable");
  const { nodes: rawNodes } = (await client.send(
    "Accessibility.getFullAXTree",
  )) as { nodes: RawAXNode[] };
  const budget: FrameBudget = { left: MAX_FRAMES_PER_READ };
  const frames = await readFrames(client, rawNodes, {
    frameOrigins: options.frameOrigins,
    budget,
  });
  const dom = await enrichFromDom(
    client,
    editableRootsOf([rawNodes, ...frames.map((f) => f.rawNodes)], options),
  );
  const rows = new Set<string>();
  for (const nodes of [rawNodes, ...frames.map((f) => f.rawNodes)]) {
    for (const id of iframeRowIds(nodes)) rows.add(`ax-dom-${id}`);
  }
  const pageProcess: ProcessRead = {
    client,
    suffix: "",
    enrichment: dom.info,
    inEditable: dom.inEditable,
  };
  const remote = await readRemoteFrames(page, pageProcess, {
    rows,
    options,
    budget,
  });
  return { rawNodes, frames: [...frames, ...remote], enrichment: dom.info };
}

/**
 * Every out-of-process frame of `page` whose row the tree keeps, each with
 * the same-process frames inside it, parents before the frames they hold.
 * A frame is left out, with every frame inside it, when its row is not in
 * `rows` (hidden, or inside a frame not read), when it is deeper than
 * {@link NATIVE_MAX_FRAME_DEPTH} or past the read's budget, when it or a
 * frame around it is from an origin a pinned session doesn't allow, or when
 * it fails to read (removed or navigated mid-read). Its row stays empty.
 */
async function readRemoteFrames(
  page: Page,
  top: ProcessRead,
  state: FrameReadState,
): Promise<NativeFramePayload[]> {
  const { options, budget } = state;
  const pinned = options.frameOrigins ? new Set(options.frameOrigins) : null;
  const main = page.mainFrame();
  const processes = new Map<Frame, ProcessRead>([[main, top]]);
  const skipped = new Set<Frame>();
  const sessions: CDPSession[] = [];
  const out: NativeFramePayload[] = [];
  const depths = new Map(page.frames().map((f) => [f, depthOf(f)]));
  const candidates = [...depths.keys()]
    .filter((f) => f !== main && depths.get(f)! <= NATIVE_MAX_FRAME_DEPTH)
    .sort((a, b) => depths.get(a)! - depths.get(b)!);
  try {
    for (const frame of candidates) {
      if (budget.left <= 0) break;
      // The process the frame's `<iframe>` lives in: the nearest frame
      // around it read in a session of its own, else the page's.
      let parent: ProcessRead | undefined;
      let blocked = false;
      for (let cur: Frame | null = frame; cur && !parent;) {
        if (
          skipped.has(cur) ||
          (pinned && cur !== main && !frameFromPinnedOrigin(cur.url(), pinned))
        ) {
          blocked = true;
          break;
        }
        cur = cur.parentFrame();
        if (cur) parent = processes.get(cur);
      }
      if (blocked || !parent) {
        skipped.add(frame);
        continue;
      }
      let session: CDPSession;
      try {
        session = await page.context().newCDPSession(frame);
      } catch {
        // It shares its parent's process, and was read with it.
        continue;
      }
      sessions.push(session);
      const read = await readRemoteFrame(
        session,
        parent,
        state,
        depths.get(frame)!,
      ).catch(() => null);
      if (!read) {
        skipped.add(frame);
        continue;
      }
      processes.set(frame, read.process);
      out.push(...read.payloads);
    }
  } finally {
    await Promise.all(sessions.map((s) => s.detach().catch(() => {})));
  }
  return out;
}

/** One out-of-process frame, read over its own `session`: its document,
 *  the same-process frames inside it, and its DOM walk. `null` when its row
 *  is not one the tree keeps, or the budget is spent. */
async function readRemoteFrame(
  session: CDPSession,
  parent: ProcessRead,
  { rows, options, budget }: FrameReadState,
  depth: number,
): Promise<{ process: ProcessRead; payloads: NativeFramePayload[] } | null> {
  const { frameTree } = (await session.send("Page.getFrameTree")) as {
    frameTree: { frame: { id: string; loaderId?: string } };
  };
  const { id: frameId, loaderId } = frameTree.frame;
  const owner = (await parent.client.send("DOM.getFrameOwner", {
    frameId,
  })) as { backendNodeId?: number };
  if (typeof owner.backendNodeId !== "number") return null;
  const ownerId = `ax-dom-${owner.backendNodeId}${parent.suffix}`;
  if (!rows.has(ownerId) || budget.left <= 0) return null;
  budget.left--;

  await session.send("Accessibility.enable");
  const { nodes } = (await session.send("Accessibility.getFullAXTree")) as {
    nodes: RawAXNode[];
  };
  const inner = await readFrames(session, nodes, {
    frameOrigins: options.frameOrigins,
    budget,
    startDepth: depth,
  });
  const dom = await enrichFromDom(
    session,
    editableRootsOf([nodes, ...inner.map((f) => f.rawNodes)], options),
    {
      frame: parent.enrichment.get(owner.backendNodeId)?.locator,
      inside: parent.inEditable.has(owner.backendNodeId),
    },
  );
  const suffix = nativeFrameSuffix({ frameId, documentId: loaderId });
  for (const doc of [nodes, ...inner.map((f) => f.rawNodes)]) {
    for (const id of iframeRowIds(doc)) rows.add(`ax-dom-${id}${suffix}`);
  }
  const of = (ownerRow: string, rawNodes: RawAXNode[]): NativeFramePayload => ({
    ownerId: ownerRow,
    rawNodes,
    enrichment: dom.info,
    suffix,
  });
  return {
    process: {
      client: session,
      suffix,
      enrichment: dom.info,
      inEditable: dom.inEditable,
    },
    payloads: [
      of(ownerId, nodes),
      ...inner.map((f) => of(`${f.ownerId}${suffix}`, f.rawNodes)),
    ],
  };
}
