import { applyStyle, styles } from "../_shared.js";

// Hand-rolled "broken" Toast. Deliberately wrong on:
//
//   1. NO role="status", NO aria-live. The container is a plain <div>.
//      AT engines have no signal to announce content changes here.
//
//   2. Content is appended (innerHTML += "<div>...</div>") rather than
//      updated in a stable live region — even with aria-live, this
//      pattern can drop announcements in some engines.
//
// Visually identical to the correct variant.
export function mountToastBroken(host: HTMLElement): void {
  const root = document.createElement("div");
  applyStyle(root, {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    minWidth: "260px",
  });

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Show toast";
  applyStyle(btn, {
    padding: "6px 12px",
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    background: "transparent",
    cursor: "pointer",
    font: styles.font,
    alignSelf: "start",
  });

  const region = document.createElement("div");
  applyStyle(region, {
    minHeight: "40px",
    padding: "8px 12px",
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    background: styles.bgSoft,
    color: styles.text,
    fontSize: "14px",
    transition: "opacity 200ms",
    opacity: "0",
  });

  let counter = 0;
  let timeout: number | null = null;

  btn.addEventListener("click", () => {
    counter += 1;
    region.textContent = `Saved successfully (#${counter})`;
    region.style.opacity = "1";
    if (timeout !== null) clearTimeout(timeout);
    timeout = window.setTimeout(() => {
      region.style.opacity = "0";
    }, 2500);
  });

  root.appendChild(btn);
  root.appendChild(region);
  host.appendChild(root);
}
