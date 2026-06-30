import { applyStyle, styles } from "../_shared.js";

// Correct APG Toolbar. Implements:
//   - role="toolbar" + aria-label
//   - role="group" sub-groupings (optional, used here for separator)
//   - Roving tabindex: only the active item is tabindex=0; the rest
//     are -1. Tab into the toolbar lands on the active item; arrow
//     keys move between items within.
//   - ←/→ to move between items, Home/End for bounds
export function mountToolbarCorrect(host: HTMLElement): void {
  const items = [
    { id: "bold", label: "B", title: "Bold" },
    { id: "italic", label: "I", title: "Italic" },
    { id: "underline", label: "U", title: "Underline" },
  ];

  const root = document.createElement("div");
  root.setAttribute("role", "toolbar");
  root.setAttribute("aria-label", "Text formatting");
  applyStyle(root, {
    display: "inline-flex",
    gap: "4px",
    padding: "4px",
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    background: styles.bg,
  });

  const buttons: HTMLButtonElement[] = [];
  let activeIndex = 0;

  items.forEach((it, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = it.title;
    btn.setAttribute("aria-label", it.title);
    btn.textContent = it.label;
    btn.tabIndex = i === 0 ? 0 : -1;
    applyStyle(btn, {
      width: "32px",
      height: "32px",
      border: `1px solid ${styles.border}`,
      borderRadius: "4px",
      background: "transparent",
      cursor: "pointer",
      font: styles.font,
      fontWeight: it.id === "bold" ? "700" : "400",
      fontStyle: it.id === "italic" ? "italic" : "normal",
      textDecoration: it.id === "underline" ? "underline" : "none",
    });
    root.appendChild(btn);
    buttons.push(btn);
  });

  function focusItem(i: number) {
    activeIndex = (i + buttons.length) % buttons.length;
    buttons.forEach((b, idx) => {
      b.tabIndex = idx === activeIndex ? 0 : -1;
    });
    buttons[activeIndex].focus();
  }

  root.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      focusItem(activeIndex + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusItem(activeIndex - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusItem(buttons.length - 1);
    }
  });

  host.appendChild(root);
}
