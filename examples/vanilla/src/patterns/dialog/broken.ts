import { applyStyle, styles } from "../_shared.js";

// Hand-rolled "broken" Dialog. Deliberately wrong on:
//
//   1. NO role="dialog", NO aria-modal. The container is a plain
//      positioned <div> — AT users hear nothing about a modal opening.
//
//   2. NO focus trap. Tab keeps moving into the page behind the dialog.
//
//   3. NO return focus on close. After closing, focus jumps to body.
//
//   4. NO Escape-to-close handler. Users must click Cancel/Confirm.
//
// Visually similar — overlay + centered card — but the entire AT and
// focus-management story is missing.
export function mountDialogBroken(host: HTMLElement): void {
  const root = document.createElement("div");
  applyStyle(root, { position: "relative" });

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.textContent = "Open dialog";
  applyStyle(trigger, {
    padding: "6px 12px",
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    background: "transparent",
    cursor: "pointer",
    font: styles.font,
  });

  const overlay = document.createElement("div");
  applyStyle(overlay, {
    position: "fixed",
    inset: "0",
    background: "rgba(0,0,0,0.4)",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "100",
  });

  const card = document.createElement("div");
  applyStyle(card, {
    background: styles.bg,
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    padding: "24px",
    maxWidth: "400px",
    width: "90%",
    boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
  });

  const title = document.createElement("h3");
  title.textContent = "Confirm action";
  applyStyle(title, { marginBottom: "8px" });

  const desc = document.createElement("p");
  desc.textContent =
    "This 'dialog' is a positioned div. No role, no aria-modal, no focus trap, no escape handler.";
  applyStyle(desc, { color: styles.textMuted, marginBottom: "16px" });

  const actions = document.createElement("div");
  applyStyle(actions, {
    display: "flex",
    gap: "8px",
    justifyContent: "flex-end",
  });

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  applyStyle(cancel, {
    padding: "6px 12px",
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    background: "transparent",
    cursor: "pointer",
    font: styles.font,
  });

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.textContent = "Confirm";
  applyStyle(confirm, {
    padding: "6px 12px",
    border: `1px solid ${styles.accent}`,
    borderRadius: styles.radius,
    background: styles.accent,
    color: "#fff",
    cursor: "pointer",
    font: styles.font,
  });

  function open() {
    overlay.style.display = "flex";
  }
  function close() {
    overlay.style.display = "none";
  }

  trigger.addEventListener("click", open);
  cancel.addEventListener("click", close);
  confirm.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  actions.appendChild(cancel);
  actions.appendChild(confirm);
  card.appendChild(title);
  card.appendChild(desc);
  card.appendChild(actions);
  overlay.appendChild(card);

  root.appendChild(trigger);
  root.appendChild(overlay);
  host.appendChild(root);
}
