import { createInspector } from "@real-a11y-dev/inspector";

// ─── Panel ────────────────────────────────────────────────────────────────────
//
// Layout (bottom-right corner, 16 px gap from edges):
//
//  ┌──────────────────────────────────────────┐
//  │▒ top-resize handle (4 px, n-resize)       │
//  ├──────────────────────────────────────────┤
//  │▒│   Semantic Navigator          [▼]       │
//  │▒├──────────────────────────────────────  │
//  │▒│                                         │
//  │▒│   TreeView (shadow DOM)                 │
//  │▒│                                         │
//  └──────────────────────────────────────────┘
//  ▒ = left-resize handle (4 px, w-resize)
//
// Resize grows UP and LEFT (anchored to the bottom-right corner).
// Title bar is the drag-to-move handle.

const PANEL_GAP = 16; // px gap from viewport edges
const DEFAULT_W = 380; // px
const DEFAULT_H = 420; // px
const TITLE_H = 40; // px — title bar height
const HANDLE_SIZE = 6; // px — resize grip thickness
const MIN_W = 260;
const MIN_H = TITLE_H; // collapsed = title bar only

// ── Wrapper ────────────────────────────────────────────────────────────────

const wrapper = document.createElement("div");
wrapper.setAttribute("role", "complementary");
wrapper.setAttribute("aria-label", "Semantic Navigator panel");
Object.assign(wrapper.style, {
  position: "fixed",
  bottom: `${PANEL_GAP}px`,
  right: `${PANEL_GAP}px`,
  width: `${DEFAULT_W}px`,
  height: `${DEFAULT_H}px`,
  minWidth: `${MIN_W}px`,
  minHeight: `${TITLE_H}px`,
  zIndex: "9999",
  display: "flex",
  flexDirection: "column",
  borderRadius: "10px",
  boxShadow: "0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)",
  border: "1px solid rgba(0,0,0,0.12)",
  background: "#ffffff",
  overflow: "hidden",
  fontFamily: "system-ui, -apple-system, sans-serif",
  userSelect: "none",
  transition: "height 150ms ease, box-shadow 150ms ease",
});
document.body.appendChild(wrapper);

// ── Resize handles ─────────────────────────────────────────────────────────

function makeHandle(styles: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  Object.assign(el.style, {
    position: "absolute",
    zIndex: "10",
    ...styles,
  } as Partial<CSSStyleDeclaration>);
  wrapper.appendChild(el);
  return el;
}

// Top edge  → drag up to grow, down to shrink
const topHandle = makeHandle({
  top: "0",
  left: `${HANDLE_SIZE}px`,
  right: "0",
  height: `${HANDLE_SIZE}px`,
  cursor: "n-resize",
});

// Left edge → drag left to grow, right to shrink
const leftHandle = makeHandle({
  top: `${HANDLE_SIZE}px`,
  left: "0",
  bottom: "0",
  width: `${HANDLE_SIZE}px`,
  cursor: "w-resize",
});

// Top-left corner → both axes
const cornerHandle = makeHandle({
  top: "0",
  left: "0",
  width: `${HANDLE_SIZE}px`,
  height: `${HANDLE_SIZE}px`,
  cursor: "nw-resize",
});

function attachResizeDrag(handle: HTMLElement, axis: "y" | "x" | "both") {
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = wrapper.getBoundingClientRect().width;
    const startH = wrapper.getBoundingClientRect().height;
    const maxW = window.innerWidth * 0.92;
    const maxH = window.innerHeight * 0.92;

    wrapper.style.transition = "none";

    const onMove = (ev: MouseEvent) => {
      if (axis === "y" || axis === "both") {
        // Drag up → bigger (anchor is bottom-right, so dy is inverted)
        const newH = Math.max(
          MIN_H,
          Math.min(maxH, startH - (ev.clientY - startY)),
        );
        wrapper.style.height = `${newH}px`;
        if (newH > TITLE_H) {
          collapsed = false;
          content.style.display = "";
          collapseBtn.textContent = "▼";
          collapseBtn.setAttribute("aria-label", "Collapse panel");
        }
      }
      if (axis === "x" || axis === "both") {
        // Drag left → bigger
        const newW = Math.max(
          MIN_W,
          Math.min(maxW, startW - (ev.clientX - startX)),
        );
        wrapper.style.width = `${newW}px`;
      }
    };

    const onUp = () => {
      wrapper.style.transition = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

attachResizeDrag(topHandle, "y");
attachResizeDrag(leftHandle, "x");
attachResizeDrag(cornerHandle, "both");

// ── Title bar ──────────────────────────────────────────────────────────────

const titleBar = document.createElement("div");
Object.assign(titleBar.style, {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: `0 10px 0 ${HANDLE_SIZE + 8}px`,
  height: `${TITLE_H}px`,
  flexShrink: "0",
  background: "#f8f9fa",
  borderBottom: "1px solid rgba(0,0,0,0.08)",
  cursor: "move",
  userSelect: "none",
});

// Indicator dot
const dot = document.createElement("span");
dot.setAttribute("aria-hidden", "true");
Object.assign(dot.style, {
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  background: "#2e79ff",
  flexShrink: "0",
});

const titleText = document.createElement("span");
titleText.textContent = "Semantic Navigator";
Object.assign(titleText.style, {
  flex: "1",
  fontSize: "12px",
  fontWeight: "600",
  color: "#374151",
  letterSpacing: "0.01em",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const collapseBtn = document.createElement("button");
collapseBtn.textContent = "▼";
collapseBtn.setAttribute("aria-label", "Collapse panel");
collapseBtn.type = "button";
Object.assign(collapseBtn.style, {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: "10px",
  color: "#9ca3af",
  padding: "4px 6px",
  borderRadius: "4px",
  lineHeight: "1",
  flexShrink: "0",
  transition: "color 120ms",
});
collapseBtn.addEventListener(
  "mouseenter",
  () => (collapseBtn.style.color = "#374151"),
);
collapseBtn.addEventListener(
  "mouseleave",
  () => (collapseBtn.style.color = "#9ca3af"),
);

titleBar.appendChild(dot);
titleBar.appendChild(titleText);
titleBar.appendChild(collapseBtn);
wrapper.appendChild(titleBar);

// ── Drag-to-move ───────────────────────────────────────────────────────────

titleBar.addEventListener("mousedown", (e) => {
  // Don't start a move when the user clicked a button inside the title bar
  if ((e.target as HTMLElement).closest("button")) return;
  e.preventDefault();

  const rect = wrapper.getBoundingClientRect();
  const startX = e.clientX;
  const startY = e.clientY;
  // Anchor is bottom-right — track those offsets from the viewport
  const startRight = window.innerWidth - rect.right;
  const startBottom = window.innerHeight - rect.bottom;

  wrapper.style.transition = "none";
  wrapper.style.cursor = "grabbing";
  document.body.style.userSelect = "none";

  const onMove = (ev: MouseEvent) => {
    const newRight = Math.max(0, startRight - (ev.clientX - startX));
    const newBottom = Math.max(0, startBottom - (ev.clientY - startY));
    wrapper.style.right = `${newRight}px`;
    wrapper.style.bottom = `${newBottom}px`;
  };

  const onUp = () => {
    wrapper.style.transition = "";
    wrapper.style.cursor = "";
    document.body.style.userSelect = "";
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
});

// ── Content area (shadow DOM mounts here) ─────────────────────────────────

const content = document.createElement("div");
Object.assign(content.style, {
  flex: "1",
  minHeight: "0",
  overflow: "hidden",
});
wrapper.appendChild(content);

// ── Collapse / expand ──────────────────────────────────────────────────────

let collapsed = false;
let savedHeight = `${DEFAULT_H}px`;

collapseBtn.addEventListener("click", () => {
  collapsed = !collapsed;
  if (collapsed) {
    savedHeight = wrapper.style.height;
    wrapper.style.height = `${TITLE_H}px`;
    content.style.display = "none";
    collapseBtn.textContent = "▲";
    collapseBtn.setAttribute("aria-label", "Expand panel");
  } else {
    wrapper.style.height = savedHeight;
    content.style.display = "";
    collapseBtn.textContent = "▼";
    collapseBtn.setAttribute("aria-label", "Collapse panel");
  }
});

// ── Semantic Navigator ─────────────────────────────────────────────────────

const sn = createInspector({
  root: document.getElementById("app")!,
  container: content,
  viewMode: "a11y",
  highlightOnHover: true,
  scrollHostOnSelect: false,
  focusHostOnActivate: false,
});

sn.mount();

// ─── Page controls ─────────────────────────────────────────────────────────

document.getElementById("btn-mode")!.addEventListener("click", () => {
  const btn = document.getElementById("btn-mode") as HTMLButtonElement;
  const current = (btn.dataset.mode ?? "a11y") as "a11y" | "dom";
  const nextMode = current === "a11y" ? "dom" : "a11y";
  sn.setViewMode(nextMode);
  btn.dataset.mode = nextMode;
  btn.textContent = `Toggle mode (currently: ${nextMode.toUpperCase()})`;
});

document.getElementById("btn-root")!.addEventListener("click", () => {
  sn.setRoot(document.getElementById("sample-form")!);
});

document.getElementById("btn-reset")!.addEventListener("click", () => {
  sn.setRoot(document.getElementById("app")!);
});

document.getElementById("btn-refresh")!.addEventListener("click", () => {
  sn.refresh();
});

// ─── Dialog ────────────────────────────────────────────────────────────────

const dialog = document.getElementById("sample-dialog") as HTMLDialogElement;

document.getElementById("btn-dialog")!.addEventListener("click", () => {
  dialog.showModal();
});

document.getElementById("btn-close-dialog")!.addEventListener("click", () => {
  dialog.close();
});

document.getElementById("btn-cancel")!.addEventListener("click", () => {
  dialog.close();
});

document.getElementById("btn-confirm")!.addEventListener("click", () => {
  dialog.close();
});

// ─── Form ──────────────────────────────────────────────────────────────────

document.getElementById("sample-form")!.addEventListener("submit", (e) => {
  e.preventDefault();
  alert("Form submitted! (This is just a demo.)");
});

// ─── Disclosure widgets — drives the cross-link chips in the panel ─────────

function wireDisclosure(triggerId: string, menuId: string) {
  const trigger = document.getElementById(triggerId) as HTMLButtonElement;
  const menu = document.getElementById(menuId) as HTMLElement;
  trigger.addEventListener("click", () => {
    const open = trigger.getAttribute("aria-expanded") === "true";
    trigger.setAttribute("aria-expanded", String(!open));
    menu.hidden = open;
  });
}

wireDisclosure("btn-explicit", "explicit-menu");
wireDisclosure("btn-inferred", "profile-menu");
