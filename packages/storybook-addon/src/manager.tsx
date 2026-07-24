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
import { TreePanel } from "@real-a11y-dev/semantic-navigator-ui";
import { addons, types } from "@storybook/manager-api";
import { render, h } from "preact";
import * as React from "react";
import { useEffect, useRef, useState, useCallback } from "react";

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
  const [isReady, setIsReady] = useState(false);
  const [payload, setPayload] = useState<TreeUpdatePayload | null>(null);
  const [viewMode, setViewMode] = useState<TreeViewMode>("a11y");

  // ── Mode handler (defined early so effects can reference it) ───────────────

  const handleViewModeChange = useCallback((mode: TreeViewMode) => {
    setViewMode(mode);
    // "tab" is a client-side transform of the current a11y tree — no re-extraction.
    if (mode !== "tab") {
      addons.getChannel().emit(EVENTS.SET_MODE, mode);
    }
  }, []);

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
      }),
      host,
    );
  }, [isReady, payload, viewMode, handleViewModeChange]);

  // ── Channel subscription ───────────────────────────────────────────────────

  useEffect(() => {
    const channel = addons.getChannel();

    const handler = (next: TreeUpdatePayload) => setPayload(next);
    channel.on(EVENTS.TREE_UPDATED, handler);

    // Ask the preview for the current tree immediately — otherwise the panel
    // shows "Waiting…" until the next DOM mutation in the story. Also starts
    // the preview-side DomObserver (extraction is lazy until this request).
    const requestTree = () => channel.emit(EVENTS.REQUEST_TREE);
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
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
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
