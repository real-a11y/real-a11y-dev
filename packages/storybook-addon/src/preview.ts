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
 * result as structured JSON over the Storybook channel — but only when that
 * result differs from the last one published, so a mutation that extracts to
 * the same tree costs no postMessage and no panel re-render. Also listens for
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
import { addons } from "storybook/preview-api";

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
/**
 * JSON of the last payload actually put on the channel, with `extractedAt`
 * left out and `mode` kept in. `null` means "nothing published since the
 * extractor was stood up", so the next publish always goes out.
 *
 * A DomObserver fire need not change the tree, and the ones that don't used to
 * ship every node with its full dom/a11y/interaction/ui sub-objects across the
 * iframe boundary and re-render the whole panel anyway. The two that matter
 * are the high-frequency ones: inline `style`/`transform` churn (a CSS
 * animation, an open menu repositioned every scroll frame) and mutations
 * inside a hidden or `aria-hidden` subtree, which the walk skips entirely.
 *
 * Note what this does NOT suppress: `class` is a key attribute, so it lands in
 * `dom.attributes` and a class toggle always publishes; and a re-render that
 * REPLACES elements mints fresh node ids, so only frameworks that patch nodes
 * in place dedup.
 *
 * Deliberately the whole JSON rather than a hash of it: this is retained only
 * while the panel is open, and it is smaller than the node Map the extractor
 * already holds, whereas a hash collision would silently withhold a real
 * update and leave the panel showing a stale tree.
 */
let lastPublished: string | null = null;

function liveExtractorMode(mode: TreeMode): "dom" | "a11y" {
  return mode === "dom" ? "dom" : "a11y";
}

function buildSerializableTree(change?: TreeChange): SerializableTree {
  const result = liveExtractor!.refresh(change);

  // Default new / rebuilt nodes to expanded for the Storybook panel's first
  // paint. The manager re-applies the user's expand/collapse from its live
  // tree ref on every TREE_UPDATED (see preserveExpandedState), so this does
  // not wipe collapses the user already made — it only seeds ids the manager
  // has not seen yet.
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

  // Always re-extract, even when nothing ends up being sent: refresh()
  // rebuilds the element WeakMap, which is what keeps highlight refs fresh.
  const tree = buildSerializableTree(change);

  // `mode` is part of the signature because it is part of the payload: two
  // modes can extract to the same nodes, and a listener reading `payload.mode`
  // (documented on the website) would never see the switch. The bundled
  // manager happens to track its own view mode, so this is for everyone else.
  // `extractedAt` is excluded — it is `Date.now()`, so including it would
  // defeat the comparison entirely.
  //
  // This costs one JSON.stringify on a publish that does go out (the channel
  // serializes independently). It buys skipping the channel's own serialize +
  // structured clone and the manager's full re-render on the fires that carry
  // nothing new, which on an animating or Controls-driven story is most of
  // them.
  const signature = JSON.stringify({ mode: currentMode, tree });
  if (signature === lastPublished) return;

  const payload: TreeUpdatePayload = {
    tree,
    mode: currentMode,
    extractedAt: Date.now(),
  };
  channel.emit(EVENTS.TREE_UPDATED, payload);
  // Only after it is actually on the channel: a throwing emit must not leave
  // an undelivered tree recorded as published, or the panel stays stale until
  // something else changes.
  lastPublished = signature;
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
  // A story render (or a panel reopen) tears this down and stands a new one
  // up, and the manager may have remounted with no tree at all — so the first
  // publish after a restart must never be withheld as a duplicate of the tree
  // the PREVIOUS extractor published.
  lastPublished = null;
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
