import { applyStyle, styles } from "../_shared.js";

// Correct APG Toast — live-region announcement. Implements:
//   - role="status" + aria-live="polite" on the live region
//     (created once and reused so AT engines that key on the region's
//     identity hear repeated announcements)
//   - Optional explicit aria-live to make the polite intent visible
//     in the audit panel
//   - Visual toast that fades after a few seconds
export function mountToastCorrect(host: HTMLElement): void {
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

  const live = document.createElement("div");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  applyStyle(live, {
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
    live.textContent = `Saved successfully (#${counter})`;
    live.style.opacity = "1";
    if (timeout !== null) clearTimeout(timeout);
    timeout = window.setTimeout(() => {
      live.style.opacity = "0";
      // Clear the text after fade so the region returns to empty state.
      window.setTimeout(() => {
        if (live.style.opacity === "0") live.textContent = "";
      }, 200);
    }, 2500);
  });

  root.appendChild(btn);
  root.appendChild(live);
  host.appendChild(root);
}
