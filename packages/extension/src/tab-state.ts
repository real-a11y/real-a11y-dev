/**
 * Per-tab frame state — pure helpers for the operations the background
 * service worker performs against `tabStates`.
 *
 * Extracted so the state-machine semantics (when does the merge timer
 * clear, what does a top-frame navigation reset, what is the new-top-frame
 * predicate) can be unit-tested without standing up the Chrome runtime.
 *
 * The Map<tabId, TabState> registry itself stays in background.ts; this
 * module just exposes the transitions.
 */

import type { FrameTree } from "./frame-merger.js";

export interface TabState {
  frames: Map<number, FrameTree>;
  /** Prefixed node id → owning frameId. Rebuilt on every merge. */
  nodeToFrame: Map<string, number>;
  /** Pending merge debounce handle; null when no merge is scheduled. */
  mergeTimer: ReturnType<typeof setTimeout> | null;
}

export function createTabState(): TabState {
  return {
    frames: new Map(),
    nodeToFrame: new Map(),
    mergeTimer: null,
  };
}

/**
 * Get-or-create a TabState in the registry. Centralised so callers can't
 * forget to seed `nodeToFrame` / `mergeTimer` independently.
 */
export function getOrCreateTabState(
  registry: Map<number, TabState>,
  tabId: number,
): TabState {
  let state = registry.get(tabId);
  if (!state) {
    state = createTabState();
    registry.set(tabId, state);
  }
  return state;
}

/**
 * Record the announce of a frame's tree.
 *
 * Returns `isNewTopFrame: true` when this announcement is the first
 * frameId-0 tree we've seen for the tab — used by the background to
 * decide whether to re-apply the curtain.
 */
export function recordFrameTree(
  state: TabState,
  frameTree: FrameTree,
): { isNewTopFrame: boolean } {
  const isNewTopFrame = frameTree.frameId === 0 && !state.frames.has(0);
  state.frames.set(frameTree.frameId, frameTree);
  return { isNewTopFrame };
}

/**
 * Reset everything that depends on the current page — used when the user
 * requests a fresh tree (`REQUEST_TREE`) or the top frame navigates.
 *
 * Does NOT clear the merge timer; an in-flight merge after a clear is
 * harmless (it just sees an empty `frames`) and clearing it would leak
 * the pending callback if the next merge isn't scheduled.
 */
export function clearTabFrames(state: TabState): void {
  state.frames.clear();
  state.nodeToFrame.clear();
}

/**
 * A subframe navigated away. Drop its tree and report whether anything
 * remains; the caller schedules a re-merge only if the answer is yes.
 */
export function removeFrame(
  state: TabState,
  frameId: number,
): { shouldRemerge: boolean } {
  state.frames.delete(frameId);
  return { shouldRemerge: state.frames.size > 0 };
}

/**
 * Tab is being torn down. Clears the debounce and drops the entry from
 * the registry. The curtain map is owned separately by background.ts
 * and is the caller's responsibility.
 */
export function disposeTabState(
  registry: Map<number, TabState>,
  tabId: number,
): void {
  const state = registry.get(tabId);
  if (state?.mergeTimer) clearTimeout(state.mergeTimer);
  registry.delete(tabId);
}
