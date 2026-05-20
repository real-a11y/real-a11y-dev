import type {
  SemanticNode,
  TreeViewMode,
  ActionRequest,
  ActionResult,
} from "@real-a11y-dev/core";
import {
  createInspector,
  type InspectorInstance,
} from "@real-a11y-dev/inspector";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

// ─── Panel constants ──────────────────────────────────────────────────────────

const PANEL_GAP = 16; // px gap from viewport edges
const TITLE_H = 40; // px — title bar height
const HANDLE_SIZE = 6; // px — resize grip thickness

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SemanticNavigatorProps {
  /**
   * A React ref pointing to the root element whose subtree is extracted.
   * Use `useRef<HTMLDivElement>(null)` in the parent and pass the ref object
   * directly — the component reads `.current` inside the effect, after the
   * DOM has been committed.
   */
  root: RefObject<Element | null>;

  /** Initial view mode. Default "a11y". */
  mode?: TreeViewMode;
  /** Mount mode: "shadow" (default, isolates CSS) or "light". */
  mount?: "shadow" | "light";
  /** Theme. Default "auto". */
  theme?: "light" | "dark" | "auto";
  /** Enable interactive actions. Default true. */
  interactive?: boolean;

  /** Draw an overlay on the real element when a tree node is hovered. Default false. */
  highlightOnHover?: boolean;
  /** Scroll the host element into view on select. Default false. */
  scrollHostOnSelect?: boolean;
  /**
   * Gate actions that move focus on the host page. Default `false`.
   *
   * When `false` the panel skips:
   *   - the bare `"focus"` action
   *   - `"increment"` / `"decrement"` for sliders/spinbuttons (widgets
   *     like Radix Slider focus their own thumb on value change; in a
   *     same-document panel that pulls focus off the panel button)
   *
   * Other actions (`click`, `toggle`, `submit`, `select`, `type`) are
   * always dispatched regardless of this flag.
   */
  focusHostOnActivate?: boolean;
  /** Optional CSP nonce applied to the injected style. */
  styleNonce?: string;

  onNodeSelect?: (node: SemanticNode) => void;
  onAction?: (request: ActionRequest, result: ActionResult) => void;

  // ── Inline (default) mode ──────────────────────────────────────────────────
  /** Optional className on the outer host div (inline mode only). */
  className?: string;
  /** Optional inline style on the outer host div (inline mode only). */
  style?: React.CSSProperties;

  // ── Floating panel mode ────────────────────────────────────────────────────
  /**
   * Render as a floating panel (fixed-position, draggable, resizable,
   * collapsible) instead of an inline div.
   *
   * The panel is injected into `document.body` via a React portal so it is
   * never clipped by ancestor `overflow` or `transform` styles.
   *
   * @default false
   */
  floating?: boolean;

  /** Panel title shown in the title bar. Default "Semantic Navigator". */
  panelTitle?: string;
  /** Initial panel width in px. Default 380. */
  panelWidth?: number;
  /** Initial panel height in px. Default 420. */
  panelHeight?: number;
  /** Gap between the panel and the viewport edges in px. Default 16. */
  panelGap?: number;
}

// ─── Floating panel shell ─────────────────────────────────────────────────────

interface PanelState {
  w: number;
  h: number;
  bottom: number;
  right: number;
  collapsed: boolean;
  savedH: number;
}

interface FloatingPanelProps {
  title: string;
  initialWidth: number;
  initialHeight: number;
  gap: number;
  children: React.ReactNode;
}

function FloatingPanel({
  title,
  initialWidth,
  initialHeight,
  gap,
  children,
}: FloatingPanelProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<PanelState>({
    w: initialWidth,
    h: initialHeight,
    bottom: gap,
    right: gap,
    collapsed: false,
    savedH: initialHeight,
  });
  // True while the user is actively dragging — disables CSS transition so
  // each frame paints immediately without lag.
  const [dragging, setDragging] = useState(false);

  // ── Resize drag ────────────────────────────────────────────────────────────
  // The panel is anchored at the bottom-right corner, so:
  //   drag top edge UP   → increase height
  //   drag left edge LEFT → increase width

  const startResize = useCallback(
    (e: React.MouseEvent, axis: "x" | "y" | "both") => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(true);

      const startX = e.clientX;
      const startY = e.clientY;
      // Capture current dimensions at drag start (avoid stale closure).
      const startW = wrapperRef.current
        ? wrapperRef.current.getBoundingClientRect().width
        : panel.w;
      const startH = wrapperRef.current
        ? wrapperRef.current.getBoundingClientRect().height
        : panel.h;

      const onMove = (ev: MouseEvent) => {
        setPanel((prev) => {
          const maxW = window.innerWidth * 0.92;
          const maxH = window.innerHeight * 0.92;
          const next = { ...prev };

          if (axis === "y" || axis === "both") {
            next.h = Math.max(
              TITLE_H,
              Math.min(maxH, startH - (ev.clientY - startY)),
            );
            // Dragging the top edge downward past the title bar auto-expands.
            if (next.h > TITLE_H && prev.collapsed) {
              next.collapsed = false;
              next.savedH = next.h;
            }
          }
          if (axis === "x" || axis === "both") {
            next.w = Math.max(
              260,
              Math.min(maxW, startW - (ev.clientX - startX)),
            );
          }
          return next;
        });
      };

      const onUp = () => {
        setDragging(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    // panel.w / panel.h are used only as fallbacks if the ref isn't ready yet.
    [panel.w, panel.h],
  );

  // ── Drag to move ───────────────────────────────────────────────────────────

  const startMove = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    setDragging(true);

    const rect = wrapperRef.current!.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    // Track how far the panel is from the viewport edges.
    const startRight = window.innerWidth - rect.right;
    const startBottom = window.innerHeight - rect.bottom;

    const onMove = (ev: MouseEvent) => {
      setPanel((prev) => ({
        ...prev,
        right: Math.max(0, startRight - (ev.clientX - startX)),
        bottom: Math.max(0, startBottom - (ev.clientY - startY)),
      }));
    };

    const onUp = () => {
      setDragging(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // ── Collapse / expand ──────────────────────────────────────────────────────

  const handleCollapse = () => {
    setPanel((prev) =>
      prev.collapsed
        ? { ...prev, collapsed: false, h: prev.savedH }
        : { ...prev, collapsed: true, savedH: prev.h, h: TITLE_H },
    );
  };

  // ─ Render ──────────────────────────────────────────────────────────────────

  const hs = HANDLE_SIZE;

  return (
    <div
      ref={wrapperRef}
      role="complementary"
      aria-label="Semantic Navigator panel"
      style={{
        position: "fixed",
        bottom: panel.bottom,
        right: panel.right,
        width: panel.w,
        height: panel.h,
        minWidth: 260,
        minHeight: TITLE_H,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)",
        border: "1px solid rgba(0,0,0,0.12)",
        background: "#ffffff",
        overflow: "hidden",
        fontFamily: "system-ui, -apple-system, sans-serif",
        userSelect: "none",
        // Disable transition while dragging so every frame renders instantly.
        transition: dragging ? "none" : "height 150ms ease",
      }}
    >
      {/* ── Resize handles ──────────────────────────────────────────────── */}

      {/* Top edge */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          left: hs,
          right: 0,
          height: hs,
          cursor: "n-resize",
          zIndex: 10,
        }}
        onMouseDown={(e) => startResize(e, "y")}
      />
      {/* Left edge */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: hs,
          left: 0,
          bottom: 0,
          width: hs,
          cursor: "w-resize",
          zIndex: 10,
        }}
        onMouseDown={(e) => startResize(e, "x")}
      />
      {/* Top-left corner */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: hs,
          height: hs,
          cursor: "nw-resize",
          zIndex: 10,
        }}
        onMouseDown={(e) => startResize(e, "both")}
      />

      {/* ── Title bar ───────────────────────────────────────────────────── */}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: `0 10px 0 ${hs + 8}px`,
          height: TITLE_H,
          flexShrink: 0,
          background: "#f8f9fa",
          borderBottom: panel.collapsed ? "none" : "1px solid rgba(0,0,0,0.08)",
          cursor: "move",
        }}
        onMouseDown={startMove}
      >
        {/* Accent dot */}
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#2e79ff",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            flex: 1,
            fontSize: 12,
            fontWeight: 600,
            color: "#374151",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
        <button
          type="button"
          aria-label={panel.collapsed ? "Expand panel" : "Collapse panel"}
          onClick={handleCollapse}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 10,
            color: "#9ca3af",
            padding: "4px 6px",
            borderRadius: 4,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {panel.collapsed ? "▲" : "▼"}
        </button>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          // Keep the tree mounted when collapsed so the SN instance stays alive;
          // just hide it visually so it takes no space.
          display: panel.collapsed ? "none" : "block",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── SemanticNavigator ────────────────────────────────────────────────────────

/**
 * React wrapper around `createInspector`.
 *
 * **Inline mode (default):** renders an empty host `div` that the caller
 * positions via CSS. The Preact tree view mounts into a shadow root inside
 * that div.
 *
 * **Floating mode (`floating`):** renders a fixed-position panel (draggable,
 * resizable, collapsible) injected into `document.body` via a React portal —
 * so it is never clipped by ancestor `overflow` or `transform` styles.
 *
 * @example Inline
 * ```tsx
 * <aside style={{ width: 380, height: "100vh" }}>
 *   <SemanticNavigator root={rootRef} style={{ height: "100%" }} />
 * </aside>
 * ```
 *
 * @example Floating panel
 * ```tsx
 * <SemanticNavigator root={rootRef} floating highlightOnHover />
 * ```
 */
export function SemanticNavigator({
  root,
  mode = "a11y",
  mount = "shadow",
  theme = "auto",
  interactive = true,
  highlightOnHover = false,
  scrollHostOnSelect = false,
  focusHostOnActivate = false,
  styleNonce,
  onNodeSelect,
  onAction,
  className,
  style,
  // Floating panel props
  floating = false,
  panelTitle = "Semantic Navigator",
  panelWidth = 380,
  panelHeight = 420,
  panelGap = PANEL_GAP,
}: SemanticNavigatorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<InspectorInstance | null>(null);

  // `floating` mode portals into `document.body`, which isn't available during
  // SSR. Delay the portal render until after the first client commit.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => {
    if (floating) setPortalReady(true);
  }, [floating]);

  // Build / tear down the instance when root element or mount mode changes.
  useEffect(() => {
    const el = root.current;
    if (!el || !hostRef.current) return;

    const instance = createInspector({
      root: el,
      container: hostRef.current,
      viewMode: mode,
      mount,
      theme,
      interactive,
      highlightOnHover,
      scrollHostOnSelect,
      focusHostOnActivate,
      styleNonce,
      onNodeSelect,
      onAction,
    });
    instance.mount();
    instanceRef.current = instance;

    return () => {
      instance.unmount();
      instanceRef.current = null;
    };
    // Callbacks and flags are updated imperatively below — not a remount trigger.
  }, [root.current, mount]);

  // Cheap prop update — swap view mode without remounting.
  useEffect(() => {
    instanceRef.current?.setViewMode(mode);
  }, [mode]);

  // The host div is shared by both rendering paths.
  // In inline mode it IS the returned element.
  // In floating mode it lives inside the FloatingPanel content area.
  const hostDiv = (
    <div
      ref={hostRef}
      className={floating ? undefined : className}
      style={floating ? { height: "100%", flex: 1, minHeight: 0 } : style}
    />
  );

  if (floating) {
    if (!portalReady) return null;
    // Portal to document.body ensures position:fixed is relative to the
    // viewport and can never be clipped by ancestor overflow/transform.
    return createPortal(
      <FloatingPanel
        title={panelTitle}
        initialWidth={panelWidth}
        initialHeight={panelHeight}
        gap={panelGap}
      >
        {hostDiv}
      </FloatingPanel>,
      document.body,
    );
  }

  return hostDiv;
}
