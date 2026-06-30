import { applyStyle, styles } from "../_shared.js";

// Hand-rolled "broken" Disclosure. Deliberately wrong on:
//
//   1. NO aria-expanded on the trigger. Screen readers can't tell if
//      the disclosure is open or closed.
//
//   2. NO aria-controls linking the trigger to the panel. The
//      "Disclosure" relationship is invisible to AT.
//
//   3. Panel uses inline display:none / "" toggling rather than the
//      `hidden` attribute. Functionally similar, but combined with the
//      missing ARIA there's no signal at all.
//
// Visually identical to the correct variant.
export function mountDisclosureBroken(host: HTMLElement): void {
  const root = document.createElement("div");
  applyStyle(root, {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    minWidth: "240px",
  });

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Show details";
  applyStyle(btn, {
    padding: "6px 12px",
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    background: "transparent",
    cursor: "pointer",
    font: styles.font,
    alignSelf: "start",
  });

  const panel = document.createElement("div");
  panel.textContent =
    "These extra details are revealed when the trigger is activated.";
  applyStyle(panel, {
    padding: "12px",
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    background: styles.bg,
    color: styles.textMuted,
    fontSize: "14px",
    display: "none",
  });

  btn.addEventListener("click", () => {
    panel.style.display = panel.style.display === "none" ? "" : "none";
  });

  root.appendChild(btn);
  root.appendChild(panel);
  host.appendChild(root);
}
