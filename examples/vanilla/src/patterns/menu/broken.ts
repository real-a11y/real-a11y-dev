import { applyStyle, styles } from "../_shared.js";

// Hand-rolled "broken" Menu. Deliberately wrong on:
//
//   1. NO aria-haspopup, NO aria-expanded on the trigger. AT can't tell
//      this button opens a menu, or whether it's open.
//
//   2. NO role="menu" / role="menuitem". The panel reads as a generic
//      group of buttons.
//
//   3. NO focus management. Opening doesn't move focus into the menu;
//      closing doesn't return focus to the trigger. All menu items
//      stay in the page's tab sequence even when the menu is closed.
//
// Visually identical to the correct variant.
export function mountMenuBroken(host: HTMLElement): void {
  const items = ["Edit profile", "Settings", "Sign out"];

  const root = document.createElement("div");
  applyStyle(root, { position: "relative", display: "inline-block" });

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.textContent = "Account ▾";
  applyStyle(trigger, {
    padding: "6px 12px",
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    background: "transparent",
    cursor: "pointer",
    font: styles.font,
  });

  const panel = document.createElement("div");
  applyStyle(panel, {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: "0",
    background: styles.bg,
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    padding: "4px",
    minWidth: "160px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    zIndex: "10",
    display: "none",
  });

  items.forEach((label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
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
    });
    btn.addEventListener("click", () => {
      panel.style.display = "none";
    });
    panel.appendChild(btn);
  });

  trigger.addEventListener("click", () => {
    panel.style.display = panel.style.display === "none" ? "" : "none";
  });

  root.appendChild(trigger);
  root.appendChild(panel);
  host.appendChild(root);
}
