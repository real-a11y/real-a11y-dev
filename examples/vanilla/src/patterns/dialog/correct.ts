import { applyStyle, styles } from "../_shared.js";

// Correct APG Dialog — uses the native <dialog> element opened via
// `.showModal()`. The browser handles:
//   - role="dialog" + aria-modal="true" (implicit)
//   - Focus trap (Tab cycles within the dialog)
//   - Backdrop overlay + click-outside-to-close (via ::backdrop)
//   - Escape closes
//   - Return focus to the invoking element
let nextId = 0;
export function mountDialogCorrect(host: HTMLElement): void {
  const titleId = `dialog-correct-title-${nextId++}`;
  const root = document.createElement("div");

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

  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-labelledby", titleId);
  applyStyle(dialog, {
    border: "none",
    borderRadius: styles.radius,
    padding: "24px",
    maxWidth: "400px",
    width: "90%",
    boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
  });

  const title = document.createElement("h3");
  title.id = titleId;
  title.textContent = "Confirm action";
  applyStyle(title, { marginBottom: "8px" });

  const desc = document.createElement("p");
  desc.textContent =
    "This dialog is opened via .showModal(). Focus is trapped while open, and Escape closes it.";
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

  trigger.addEventListener("click", () => dialog.showModal());
  cancel.addEventListener("click", () => dialog.close());
  confirm.addEventListener("click", () => dialog.close());

  actions.appendChild(cancel);
  actions.appendChild(confirm);
  dialog.appendChild(title);
  dialog.appendChild(desc);
  dialog.appendChild(actions);

  root.appendChild(trigger);
  root.appendChild(dialog);
  host.appendChild(root);
}
