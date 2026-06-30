import { applyStyle, styles } from "../_shared.js";

// Hand-rolled "broken" Listbox. Deliberately wrong on:
//
//   1. NO role="listbox" on the container, NO aria-label. Reads as
//      a generic group of buttons.
//
//   2. Items are plain <button>s with NO role="option" and NO
//      aria-selected on the selected one. Selection is conveyed
//      visually (bold) only — invisible to AT.
//
//   3. Every button stays in the tab sequence — no roving tabindex.
export function mountListboxBroken(host: HTMLElement): void {
  const opts = [
    { id: "low", label: "Low" },
    { id: "med", label: "Medium" },
    { id: "high", label: "High" },
  ];

  let selectedIndex = 1;
  const root = document.createElement("div");
  applyStyle(root, {
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    padding: "4px",
    minWidth: "200px",
    background: styles.bg,
  });

  const buttons: HTMLButtonElement[] = opts.map((o, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = o.label;
    applyStyle(btn, {
      display: "block",
      width: "100%",
      textAlign: "left",
      padding: "6px 10px",
      border: "none",
      borderRadius: "4px",
      background: "transparent",
      cursor: "pointer",
      font: styles.font,
      fontWeight: i === selectedIndex ? "600" : "400",
    });
    btn.addEventListener("click", () => {
      selectedIndex = i;
      buttons.forEach((b, idx) => {
        b.style.fontWeight = idx === selectedIndex ? "600" : "400";
      });
    });
    root.appendChild(btn);
    return btn;
  });

  host.appendChild(root);
}
