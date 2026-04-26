/**
 * Preview-side entry for the Semantic Navigator Storybook addon.
 *
 * Runs inside the story iframe: observes DOM mutations on the story root,
 * re-extracts the tree on each debounced change, and broadcasts the result
 * as structured JSON over the Storybook channel.
 *
 * Also listens for highlight / activate requests from the manager panel and
 * applies them to the real story DOM via FocusManager / ActionDispatcher.
 */
import {
  extractDomTree,
  extractA11yTree,
  DomObserver,
  FocusManager,
  ActionDispatcher,
  getElementRefs,
} from "@real-a11y-dev/core";
import { addons } from "@storybook/preview-api";

import {
  EVENTS,
  type TreeMode,
  type TreeUpdatePayload,
  type SerializableTree,
} from "./constants.js";

function getStoryRoot(): Element {
  const sb = document.getElementById("storybook-root");
  // Skip the Storybook wrapper div — start the tree at the story's own content.
  // firstElementChild is the rendered component; fall back to the wrapper itself
  // only when the story hasn't rendered yet or renders nothing.
  return sb?.firstElementChild ?? sb ?? document.body;
}

let observer: DomObserver | null = null;
let focusManager: FocusManager | null = null;
let dispatcher: ActionDispatcher | null = null;
let currentMode: TreeMode = "a11y";

function buildSerializableTree(
  root: Element,
  mode: TreeMode,
): SerializableTree {
  // "tab" mode displays data from the a11y tree — no separate extraction.
  const result = mode === "dom" ? extractDomTree(root) : extractA11yTree(root);

  // Reset ui state so the manager always starts fresh (expanded, visible, etc.)
  for (const node of result.nodes.values()) {
    node.ui.expanded = true;
    node.ui.highlighted = false;
    node.ui.matchesFilter = true;
    node.ui.selected = false;
  }

  return {
    // Convert Map → JSON-safe array
    nodes: [...result.nodes.entries()],
    rootId: result.rootId,
  };
}

function publish() {
  const root = getStoryRoot();
  const channel = addons.getChannel();

  const payload: TreeUpdatePayload = {
    tree: buildSerializableTree(root, currentMode),
    mode: currentMode,
    extractedAt: Date.now(),
  };
  channel.emit(EVENTS.TREE_UPDATED, payload);
}

function start() {
  if (observer) return;
  const root = getStoryRoot();

  const refs = getElementRefs();
  focusManager = new FocusManager(refs);
  dispatcher = new ActionDispatcher(refs);

  // Re-extract (and refresh the element WeakMap) on every DOM mutation.
  observer = new DomObserver(
    root,
    () => {
      // Re-extraction rebuilds the WeakMap so highlight refs stay fresh.
      publish();
    },
    200,
  );
  observer.start();
  publish();
}

function stop() {
  observer?.stop();
  focusManager?.destroy();
  observer = null;
  focusManager = null;
  dispatcher = null;
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

if (typeof document !== "undefined") {
  const channel = addons.getChannel();

  // Manager mounted / became visible → send the current tree immediately.
  channel.on(EVENTS.REQUEST_TREE, () => {
    if (observer) publish();
  });

  // Manager requests a mode change → re-extract with the new mode.
  channel.on(EVENTS.SET_MODE, (mode: TreeMode) => {
    currentMode = mode;
    publish();
  });

  // Manager selected a node → highlight it in the story.
  channel.on(EVENTS.HIGHLIGHT_NODE, (nodeId: string) => {
    focusManager?.highlightElement(nodeId, { scroll: false, overlay: true });
  });

  // Manager cleared selection → remove highlight overlay.
  channel.on(EVENTS.CLEAR_HIGHLIGHT, () => {
    focusManager?.clearHighlight();
  });

  // Manager activated a node → dispatch the action in the story.
  channel.on(
    EVENTS.ACTIVATE_NODE,
    ({ nodeId, action }: { nodeId: string; action: string }) => {
      dispatcher?.dispatch({ nodeId, action: action as never });
    },
  );

  channel.on("storyRendered", () => {
    stop();
    start();
  });
  channel.on("storyChanged", () => {
    stop();
    setTimeout(start, 50);
  });
}
