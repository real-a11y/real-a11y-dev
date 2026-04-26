import {
  extractDomTree,
  extractA11yTree,
  type SemanticNode,
  type TreeViewMode,
  type ActionRequest,
  type ActionResult,
  type ExtractionResult,
  type SemanticNavigatorConfig,
} from "@real-a11y-dev/core";
import { TreeView } from "@real-a11y-dev/semantic-navigator-ui";
import { render, h } from "preact";

declare const __SN_STYLES__: string;

// Re-export core types for convenience
export type {
  SemanticNode,
  TreeViewMode,
  ActionRequest,
  ActionResult,
  SemanticNavigatorConfig,
};

/** Public handle returned by `createInspector`. */
export interface InspectorInstance {
  /** Mount the tree view into the container (no-op if already mounted). */
  mount(): void;
  /** Unmount and clean up; safe to call more than once. */
  unmount(): void;
  /** Alias for `unmount()` — retained for backwards compatibility. */
  destroy(): void;
  /** Switch between DOM and A11Y view modes. */
  setViewMode(mode: TreeViewMode): void;
  /** Swap the observed root element without tearing down the instance. */
  setRoot(root: Element): void;
  /** Force a fresh extraction of the current root (e.g. after a test mutation). */
  refresh(): void;
  /**
   * Read the current extraction result without rendering. Useful from tests
   * or from a host app that wants the tree data alongside the UI.
   */
  getTree(): ExtractionResult;
}

/**
 * Create a Semantic Navigator instance.
 *
 * By default the tree view is mounted inside a ShadowRoot so the host app's
 * CSS cannot leak in and the SN styles cannot leak out. Host-app side effects
 * — highlight overlay, scroll, focus — are opt-in; pass the corresponding
 * flags in the config when you want them.
 *
 * @example
 * ```ts
 * const nav = createInspector({
 *   root: document.getElementById("app")!,
 *   container: document.getElementById("tree-panel")!,
 *   viewMode: "a11y",
 * });
 * nav.mount();
 * ```
 */
export function createInspector(
  config: SemanticNavigatorConfig,
): InspectorInstance {
  const {
    container,
    viewMode = "a11y",
    interactive = true,
    theme = "auto",
    mount: mountMode = "shadow",
    highlightOnHover = false,
    scrollHostOnSelect = false,
    focusHostOnActivate = false,
    styleNonce,
    onNodeSelect,
    onAction,
  } = config;

  let currentRoot = config.root;
  let currentViewMode = viewMode;
  let mounted = false;
  let renderTarget: Element | ShadowRoot | null = null;
  let renderHost: HTMLElement | null = null;
  // Monotonic counter used to force a re-extraction when `refresh()` is called.
  let refreshKey = 0;

  function ensureRenderTarget(): Element | ShadowRoot {
    if (renderTarget) return renderTarget;

    if (mountMode === "shadow") {
      // Reuse an existing shadow root when available (e.g. React 18 StrictMode
      // runs effects twice: mount → cleanup → mount on the same container
      // element, and `attachShadow` throws if a root is already attached).
      const existingShadow = container.shadowRoot;
      const shadow =
        existingShadow ??
        (container.attachShadow
          ? container.attachShadow({ mode: "open" })
          : null);

      if (!shadow) {
        // Environment without shadow DOM support — fall back to light DOM.
        renderTarget = container;
      } else {
        if (!existingShadow) {
          // Fresh shadow root — inject styles once.
          const style = document.createElement("style");
          if (styleNonce) style.setAttribute("nonce", styleNonce);
          style.textContent = __SN_STYLES__;
          shadow.appendChild(style);
        }

        // Reuse the existing host div, or create one if this is the first mount.
        // Preact needs a real Element (not the ShadowRoot) as its mount point.
        const existingHost =
          shadow.querySelector<HTMLElement>(".sn-shadow-host");
        const host = existingHost ?? document.createElement("div");
        if (!existingHost) {
          host.className = "sn-shadow-host";
          // height:100% lets .sn-root resolve its own height:100% against the
          // shadow host element's computed size (set by the caller via flex/grid).
          // Without this the tree grows to fit content and never scrolls.
          host.style.cssText =
            "height:100%;display:flex;flex-direction:column;";
          shadow.appendChild(host);
        }
        renderHost = host;
        renderTarget = shadow;
      }
    } else {
      // Light DOM: inject the style into document.head once.
      if (!document.getElementById("sn-styles")) {
        const style = document.createElement("style");
        style.id = "sn-styles";
        if (styleNonce) style.setAttribute("nonce", styleNonce);
        style.textContent = __SN_STYLES__;
        document.head.appendChild(style);
      }
      renderTarget = container;
    }

    return renderTarget;
  }

  function renderTree() {
    if (!mounted) return;
    const target = ensureRenderTarget();
    // When rendering into a shadow root we use the inner host div so Preact's
    // reconciler has a stable Element parent.
    const mountPoint: Element = renderHost ?? (target as Element);

    render(
      h(TreeView, {
        // Re-keying forces the inner TreeView to re-run extraction when the
        // root changes or `refresh()` bumps the counter.
        key: `${currentRoot.tagName}-${refreshKey}`,
        root: currentRoot,
        initialViewMode: currentViewMode,
        interactive,
        theme,
        highlightOnHover,
        scrollHostOnSelect,
        focusHostOnActivate,
        onNodeSelect,
        onAction: onAction
          ? (request: ActionRequest) => onAction(request, { success: true })
          : undefined,
      }),
      mountPoint,
    );
  }

  const instance: InspectorInstance = {
    mount() {
      if (mounted) return;
      mounted = true;
      renderTree();
    },

    unmount() {
      if (!mounted) return;
      mounted = false;
      const mountPoint = renderHost ?? (renderTarget as Element | null);
      if (mountPoint) render(null, mountPoint);
      // Drop references so the next mount() rebuilds cleanly.
      renderHost = null;
      renderTarget = null;
    },

    destroy() {
      instance.unmount();
    },

    setViewMode(mode: TreeViewMode) {
      currentViewMode = mode;
      renderTree();
    },

    setRoot(root: Element) {
      currentRoot = root;
      refreshKey++;
      renderTree();
    },

    refresh() {
      refreshKey++;
      renderTree();
    },

    getTree() {
      return currentViewMode === "dom"
        ? extractDomTree(currentRoot)
        : extractA11yTree(currentRoot);
    },
  };

  return instance;
}
