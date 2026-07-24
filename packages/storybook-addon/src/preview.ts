/**
 * Preview-side entry for the Semantic Navigator Storybook addon.
 *
 * Runs inside the story iframe. Extraction is **lazy**: the DomObserver and
 * LiveTreeExtractor only run while the manager panel is open (from the first
 * `REQUEST_TREE` until `STOP_TREE`). That keeps animating / Controls-driven
 * stories from paying extract + postMessage cost when the developer is on
 * another tab.
 *
 * While active, re-extracts on debounced DOM mutations and broadcasts the
 * result as structured JSON over the Storybook channel. Also listens for
 * highlight / activate requests and applies them via FocusManager /
 * ActionDispatcher.
 */
import {
  LiveTreeExtractor,
  DomObserver,
  FocusManager,
  ActionDispatcher,
  getElementRefs,
} from "@real-a11y-dev/core";
import type { TreeChange, DomSemanticNode } from "@real-a11y-dev/core";
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
const NON_RENDERED_TAGS = new Set(["template", "script", "style", "noscript"]);

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
let liveExtractor: LiveTreeExtractor | null = null;
let currentMode: TreeMode = "a11y";
/** True while the manager panel wants a live tree (REQUEST_TREE … STOP_TREE). */
let panelWantsTree = false;

function liveExtractorMode(mode: TreeMode): "dom" | "a11y" {
  return mode === "dom" ? "dom" : "a11y";
}

function buildSerializableTree(change?: TreeChange): SerializableTree {
  const result = liveExtractor!.refresh(change);

  // Reset ui state so the manager always starts fresh (expanded, visible, etc.).
  // LiveTreeExtractor is the DOM producer, so every node has a `ui` facet.
  for (const node of result.nodes.values() as IterableIterator<DomSemanticNode>) {
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

function publish(change?: TreeChange) {
  // The extractor only exists while the panel is open (start()). Channel
  // events such as SET_MODE can arrive before that, so publishing must be a
  // no-op until then rather than dereferencing a null extractor.
  if (!liveExtractor) return;
  const channel = addons.getChannel();

  const payload: TreeUpdatePayload = {
    tree: buildSerializableTree(change),
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

  liveExtractor = new LiveTreeExtractor(root, {
    mode: liveExtractorMode(currentMode),
  });

  // Re-extract (and refresh the element WeakMap) on every DOM mutation.
  observer = new DomObserver(
    root,
    (change) => {
      // Re-extraction rebuilds the WeakMap so highlight refs stay fresh.
      publish(change);
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
  liveExtractor = null;
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

if (typeof document !== "undefined") {
  const channel = addons.getChannel();

  // Manager mounted / became visible → start observing and send the tree.
  channel.on(EVENTS.REQUEST_TREE, () => {
    panelWantsTree = true;
    if (!observer) {
      start();
    }
    // Already running: skip a second publish — storyRendered/start already
    // sent TREE_UPDATED. Re-REQUEST while idle is what resumes after reload.
  });

  // Manager unmounted / switched away → stop paying extract + channel cost.
  channel.on(EVENTS.STOP_TREE, () => {
    panelWantsTree = false;
    stop();
  });

  // Manager requests a mode change → re-extract with the new mode.
  channel.on(EVENTS.SET_MODE, (mode: TreeMode) => {
    currentMode = mode;
    liveExtractor?.setMode(liveExtractorMode(currentMode));
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
    if (panelWantsTree) start();
  });
  channel.on("storyChanged", () => {
    stop();
    if (panelWantsTree) {
      setTimeout(() => {
        // Panel may have closed during the delay.
        if (panelWantsTree) start();
      }, 50);
    }
  });

  // Tell an already-open manager panel that this preview iframe is ready so it
  // can re-send REQUEST_TREE after a canvas reload (module state was reset).
  channel.emit(EVENTS.PREVIEW_READY);
}
