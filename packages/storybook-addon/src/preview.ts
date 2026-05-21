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

/**
 * Tags that never render visible content but routinely appear as direct
 * children of `#storybook-root` for component-library reasons (React
 * Aria's collection-builder mounts a `<template>` ahead of the actual
 * rendered widget; some libs inject `<script>` hydration markers). These
 * are skipped when picking the "real" root so the addon doesn't start
 * extracting from an empty `<template>` and report "Empty tree".
 */
const NON_RENDERED_TAGS = new Set([
  "template",
  "script",
  "style",
  "noscript",
]);

/**
 * Pick the root element the tree extraction + DomObserver should hang off
 * for the current story. Pure / DOM-only — exported for unit testing.
 *
 * Strategy:
 *   1. No `#storybook-root` yet → fall back to `document.body` (story
 *      hasn't rendered).
 *   2. Filter out tags that produce no visible content (`<template>`,
 *      `<script>`, ...) from the wrapper's direct children.
 *   3. Exactly one "real" child remains → use it as the root. Preserves
 *      the original behavior for the common single-root component case
 *      and keeps the tree free of the `#storybook-root` wrapper noise.
 *   4. Zero or 2+ real children → use the wrapper itself. Covers:
 *        - React Aria patterns (Tree, ListBox, ComboBox) that mount a
 *          `<template>` + actual widget + focus guards as siblings — the
 *          previous `firstElementChild` lookup picked the `<template>`
 *          and the inspector reported "Empty tree" + stale state on
 *          selection changes (the DomObserver was scoped to an empty
 *          element so it never fired re-extracts).
 *        - React Portal / Vue Teleport siblings hoisted to the story
 *          root for layout reasons.
 *        - Empty initial render (no children at all).
 */
export function pickStoryRoot(doc: Document): Element {
  const sb = doc.getElementById("storybook-root");
  if (!sb) return doc.body;
  const realChildren = Array.from(sb.children).filter(
    (c) => !NON_RENDERED_TAGS.has(c.tagName.toLowerCase()),
  );
  if (realChildren.length === 1) return realChildren[0];
  return sb;
}

function getStoryRoot(): Element {
  return pickStoryRoot(document);
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
