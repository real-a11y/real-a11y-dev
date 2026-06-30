import { applyStyle, styles } from "../_shared.js";

// Hand-rolled "broken" Toolbar. Deliberately wrong on:
//
//   1. NO role="toolbar". The container reads as a generic group.
//      AT users hear nothing about a toolbar relationship.
//
//   2. NO roving tabindex. Every button stays in the tab sequence,
//      so Tab moves through them one-by-one rather than arrow-nav
//      within a single tab stop.
//
//   3. NO arrow-key navigation. Pressing ←/→ does nothing.
export function mountToolbarBroken(host: HTMLElement): void {
  const items = [
    { id: "bold", label: "B", title: "Bold" },
    { id: "italic", label: "I", title: "Italic" },
    { id: "underline", label: "U", title: "Underline" },
  ];

  const root = document.createElement("div");
  applyStyle(root, {
    display: "inline-flex",
    gap: "4px",
    padding: "4px",
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    background: styles.bg,
  });

  items.forEach((it) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = it.title;
    btn.textContent = it.label;
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
  });

  host.appendChild(root);
}
