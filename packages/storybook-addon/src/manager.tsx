/**
 * Manager-side entry for the Semantic Navigator Storybook addon.
 *
 * Registers a Storybook panel that:
 * - receives structured ExtractionResult data from the preview via channel
 * - mounts the Preact TreePanel inside a shadow root (CSS-isolated)
 * - proxies hover / activate events back to the preview so the real story DOM
 *   responds (highlight overlay, interactions)
 */
import type {
  SemanticNode,
  ExtractionResult,
  TreeViewMode,
  ActionType,
} from "@real-a11y-dev/core";
import {
  TreePanel,
  preserveExpandedState,
} from "@real-a11y-dev/semantic-navigator-ui";
import { render, h } from "preact";
import * as React from "react";
import { useEffect, useRef, useState, useCallback } from "react";
import { addons, types, useAddonState } from "storybook/manager-api";

import {
  ADDON_ID,
  PANEL_ID,
  EVENTS,
  type TreeUpdatePayload,
  type SerializableTree,
} from "./constants.js";

declare const __SN_STYLES__: string;

// ── Deserialization ───────────────────────────────────────────────────────────

function deserializeTree(serializable: SerializableTree): ExtractionResult {
  return {
    nodes: new Map(serializable.nodes),
    rootId: serializable.rootId,
    // The addon only ever shows DOM-produced trees.
    source: { producer: "dom" },
  };
}

// ── Panel component ───────────────────────────────────────────────────────────

function Panel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const preactHostRef = useRef<HTMLElement | null>(null);
  // The Map TreePanel mutates on expand/collapse. Payload state is the
  // serializable channel message (always reset to the preview's heuristic),
  // so we must re-apply expansion from this ref on every TREE_UPDATED.
  const liveTreeRef = useRef<ExtractionResult | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [payload, setPayload] = useState<TreeUpdatePayload | null>(null);
  // Both modes live in the manager's store, not in this component: Storybook
  // unmounts the panel on a docs page (Storybook 9 behind another addon tab as
  // well), and the panel it mounts on the way back has to come back in the
  // mode the old one was in.
  const [viewMode, setViewMode] = useAddonState<TreeViewMode>(
    `${ADDON_ID}/view-mode`,
    "a11y",
  );
  // The mode the preview extracts in, sent with every REQUEST_TREE: the last
  // one picked other than "tab", which is a view of whichever tree is current.
  const [extractionMode, setExtractionMode] = useAddonState<
    Exclude<TreeViewMode, "tab">
  >(`${ADDON_ID}/extraction-mode`, "a11y");
  // Read through a ref, so a mode change doesn't re-run the channel
  // subscription; seeded from the store, so this panel's first REQUEST_TREE
  // already carries the kept mode and the preview never extracts an A11Y tree
  // under a DOM toggle.
  const extractionModeRef = useRef(extractionMode);
  // "Show full names", from the panel's Settings. In the manager's store, as
  // the modes are, for the same reason: the panel Storybook mounts on the way
  // back from a docs page (Storybook 9: another addon tab) would otherwise
  // start over. Read through a ref by the render below, which hands it to
  // TreePanel only as where it starts: TreePanel applies a change itself, and
  // re-running the render for one would rebuild the whole tree.
  const [showFullNames, setShowFullNames] = useAddonState<boolean>(
    `${ADDON_ID}/show-full-names`,
    false,
  );
  const showFullNamesRef = useRef(showFullNames);
  showFullNamesRef.current = showFullNames;

  // ── Mode handler (defined early so effects can reference it) ───────────────

  const handleViewModeChange = useCallback(
    (mode: TreeViewMode) => {
      setViewMode(mode);
      // "tab" is a client-side transform of the current a11y tree — no re-extraction.
      if (mode !== "tab") {
        extractionModeRef.current = mode;
        setExtractionMode(mode);
        addons.getChannel().emit(EVENTS.SET_MODE, mode);
      }
    },
    [setViewMode, setExtractionMode],
  );

  // ── Shadow root setup — runs once on mount ─────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Re-use existing shadow root when StrictMode double-mounts.
    const shadow =
      container.shadowRoot ?? container.attachShadow({ mode: "open" });

    if (!shadow.querySelector("style")) {
      const style = document.createElement("style");
      style.textContent = __SN_STYLES__;
      shadow.appendChild(style);
    }

    let host = shadow.querySelector<HTMLElement>(".sn-sb-host");
    if (!host) {
      host = document.createElement("div");
      host.className = "sn-sb-host";
      // Absolutely fill the shadow host element so height resolves correctly.
      host.style.cssText =
        "position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden;";
      shadow.appendChild(host);
    }
    preactHostRef.current = host;
    setIsReady(true);

    return () => {
      // Unmount Preact tree cleanly when the panel is hidden / component unmounts.
      if (host) render(null, host);
    };
  }, []);

  // ── Visibility — read off the panel's own box ──────────────────────────────

  // Storybook hides an addon panel without unmounting it. From 10.1 every panel
  // stays mounted with `active: true`, the unselected ones `display: none`; and
  // on every version a collapsed addon panel keeps its tab mounted at zero
  // width or height. So the preview is asked for a tree only while this box has
  // an area, and a hidden panel keeps its tree, expansion and search for when
  // it comes back.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setIsVisible(width > 0 && height > 0);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ── Re-render Preact TreePanel whenever data or view mode changes ───────────

  useEffect(() => {
    const host = preactHostRef.current;
    if (!isReady || !host) return;

    const channel = addons.getChannel();

    if (!payload) {
      render(
        h(
          "div",
          {
            style:
              "display:flex;align-items:center;justify-content:center;" +
              "height:100%;color:#6b7280;font-family:system-ui,sans-serif;font-size:14px;",
          },
          "Waiting for story to render…",
        ),
        host,
      );
      return;
    }

    const treeData = deserializeTree(payload.tree);
    if (liveTreeRef.current) {
      preserveExpandedState(liveTreeRef.current, treeData);
    }
    liveTreeRef.current = treeData;

    render(
      h(TreePanel, {
        treeData,
        viewMode,
        onViewModeChange: handleViewModeChange,
        theme: "auto",
        onSelect: (nodeId: string, _node: SemanticNode) => {
          channel.emit(EVENTS.HIGHLIGHT_NODE, nodeId);
        },
        onActivate: (nodeId: string, action: ActionType) => {
          channel.emit(EVENTS.ACTIVATE_NODE, { nodeId, action });
        },
        onHover: (nodeId: string | null) => {
          if (nodeId) channel.emit(EVENTS.HIGHLIGHT_NODE, nodeId);
          else channel.emit(EVENTS.CLEAR_HIGHLIGHT);
        },
        defaultShowFullNames: showFullNamesRef.current,
        onShowFullNamesChange: setShowFullNames,
      }),
      host,
    );
  }, [isReady, payload, viewMode, handleViewModeChange, setShowFullNames]);

  // ── Channel subscription — while the panel can be seen ─────────────────────

  useEffect(() => {
    if (!isVisible) return;
    const channel = addons.getChannel();

    const handler = (next: TreeUpdatePayload) => setPayload(next);
    channel.on(EVENTS.TREE_UPDATED, handler);

    // Ask the preview for the current tree immediately — otherwise the panel
    // shows "Waiting…" until the next DOM mutation in the story. Also starts
    // the preview-side DomObserver (extraction is lazy until this request).
    // The mode rides along: the preview keeps the last one it was sent, and
    // starts over in "a11y" whenever the canvas reloads.
    const requestTree = () =>
      channel.emit(EVENTS.REQUEST_TREE, extractionModeRef.current);
    requestTree();

    // The preview module holds `panelWantsTree` in iframe memory. A canvas
    // reload re-executes that module (flag resets to false) but this Panel
    // stays mounted — so we must re-REQUEST when the preview announces it is
    // ready. Do NOT re-REQUEST on every storyRendered: the preview already
    // restarts the observer for open panels, and a second REQUEST would
    // double-extract + double-postMessage on every story render.
    channel.on(EVENTS.PREVIEW_READY, requestTree);

    return () => {
      channel.off(EVENTS.TREE_UPDATED, handler);
      channel.off(EVENTS.PREVIEW_READY, requestTree);
      // Tear down the preview observer so hidden-panel stories don't keep
      // extracting and postMessage-ing full trees across the iframe boundary.
      channel.emit(EVENTS.STOP_TREE);
    };
  }, [isVisible]);

  // ── Render ─────────────────────────────────────────────────────────────────

  // In flow, not `position: absolute`: from Storybook 10.1 the tab panel has no
  // positioning of its own, so an absolute box resolves against the whole addon
  // region and covers the tab bar.
  return (
    <div
      ref={containerRef}
      style={{ position: "relative", height: "100%", overflow: "hidden" }}
    />
  );
}

// ── Registration ──────────────────────────────────────────────────────────────

addons.register(ADDON_ID, () => {
  addons.add(PANEL_ID, {
    type: types.PANEL,
    title: "Semantic Navigator",
    match: ({ viewMode }) => viewMode === "story",
    render: ({ active }) => (active ? <Panel /> : null),
  });
});
