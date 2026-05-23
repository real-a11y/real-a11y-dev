import { applyStyle, styles } from "../_shared.js";

// Correct APG Disclosure. Implements:
//   - Button trigger with aria-expanded reflecting state
//   - aria-controls pointing at the panel's id
//   - Panel hidden/shown via the `hidden` attribute (so AT can ignore
//     it entirely when collapsed)
let nextId = 0;
export function mountDisclosureCorrect(host: HTMLElement): void {
  const id = `disclosure-correct-${nextId++}`;
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
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", id);
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
  panel.id = id;
  panel.hidden = true;
  panel.textContent =
    "These extra details are revealed when the trigger is activated. Screen readers hear 'expanded' / 'collapsed' as the state changes.";
  applyStyle(panel, {
    padding: "12px",
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    background: styles.bg,
    color: styles.textMuted,
    fontSize: "14px",
  });

  btn.addEventListener("click", () => {
    const open = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!open));
    panel.hidden = open;
  });

  root.appendChild(btn);
  root.appendChild(panel);
  host.appendChild(root);
}
