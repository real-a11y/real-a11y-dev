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
  /**
   * Whether this worker has already checked for frames the page has but we
   * hold no tree for. Worker-scoped on purpose — see {@link clearTabFrames}
   * and the background's `recoverMissingFrames`.
   */
  recoveryChecked: boolean;
  /**
   * Frames whose tree we dropped on purpose and have not heard from since.
   * The recovery must not read these as "lost" and solicit them: a frame
   * that is mid-navigation still answers, from the document it is leaving.
   */
  droppedFrames: Set<number>;
}

export function createTabState(): TabState {
  return {
    frames: new Map(),
    nodeToFrame: new Map(),
    mergeTimer: null,
    recoveryChecked: false,
    droppedFrames: new Set(),
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
  state.droppedFrames.delete(frameTree.frameId);
  return { isNewTopFrame };
}

/**
 * Reset everything that depends on the current page — used when the user
 * requests a fresh tree (`REQUEST_TREE`) or the top frame navigates.
 *
 * Does NOT clear the merge timer; an in-flight merge after a clear is
 * harmless (it just sees an empty `frames`) and clearing it would leak
 * the pending callback if the next merge isn't scheduled.
 *
 * Does NOT re-arm `recoveryChecked`. That flag is scoped to the worker, which
 * is the scope the fault it guards against has: losing `tabStates` is what a
 * restart does, and a restart always starts from a fresh state anyway. Tying
 * it to the frame map instead would re-arm on every panel `REQUEST_TREE` too
 * — which `App.tsx` sends after every dispatch, submit and refresh — so any
 * frame that never answers would cost a wasted solicit and a held-back
 * publish on every user interaction, for the tab's lifetime.
 *
 * The cost of that choice: a clear that is NOT followed by a re-announce
 * strands whatever was in the map. An aborted top-frame navigation (a
 * download link, a 204) does exactly that — `onBeforeNavigate` fires, nothing
 * loads, and the old document stays alive, observing and silent. Covering it
 * needs a per-frame pending set that can tell the two emptied states apart;
 * `removeFrame` has the same gap one scope down.
 */
export function clearTabFrames(state: TabState): void {
  state.frames.clear();
  state.nodeToFrame.clear();
  // Everything is dropped, so nothing is individually "dropped" any more —
  // the whole-map case is handled by the `frames.has(0)` guard in the merge.
  state.droppedFrames.clear();
}

/**
 * A subframe navigated away. Drop its tree and report whether anything
 * remains; the caller schedules a re-merge only if the answer is yes.
 *
 * Records the id as deliberately dropped so the recovery doesn't read the
 * hole as a lost tree and solicit it — the frame is mid-navigation, and its
 * outgoing document would answer with the tree we just chose to discard.
 * Cleared when the frame announces again.
 */
export function removeFrame(
  state: TabState,
  frameId: number,
): { shouldRemerge: boolean } {
  state.frames.delete(frameId);
  state.droppedFrames.add(frameId);
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
