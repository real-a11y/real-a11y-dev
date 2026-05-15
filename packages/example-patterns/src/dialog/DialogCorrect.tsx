import * as Dialog from "@radix-ui/react-dialog";

import type { DialogExampleProps } from "./types.js";

// Correct APG modal dialog, courtesy of @radix-ui/react-dialog.
//
// Radix provides:
//   - role="dialog" + aria-modal="true" on the content
//   - aria-labelledby / aria-describedby wired to Title / Description
//   - Focus moves to the first focusable element inside the dialog on
//     open, traps within while open, returns to the trigger on close
//   - Escape closes the dialog
//   - Body scroll is locked while open
//
// Inspecting this with Real A11y's panel shows the dialog as the
// active modal (modality is one of the panel's signature surfaces).
// The audit-snapshot scope narrows to inside the dialog when it's
// open, exactly like a screen reader's reading order.
export function DialogCorrect({
  trigger,
  title,
  description,
  children,
}: DialogExampleProps) {
  return (
    <Dialog.Root>
      <Dialog.Trigger
        style={{
          padding: "6px 12px",
          border: "1px solid var(--vp-c-border, #ccc)",
          borderRadius: 6,
          background: "transparent",
          cursor: "pointer",
          font: "inherit",
        }}
      >
        {trigger}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.4)",
          }}
        />
        <Dialog.Content
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "var(--vp-c-bg, #fff)",
            padding: 24,
            borderRadius: 8,
            minWidth: 320,
            maxWidth: 480,
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.15)",
          }}
        >
          <Dialog.Title style={{ margin: 0, fontSize: "1.125rem" }}>
            {title}
          </Dialog.Title>
          {description ? (
            <Dialog.Description
              style={{ marginTop: 4, color: "var(--vp-c-text-2)" }}
            >
              {description}
            </Dialog.Description>
          ) : null}
          <div style={{ marginTop: 16 }}>{children}</div>
          <Dialog.Close
            style={{
              marginTop: 16,
              padding: "6px 12px",
              border: "1px solid var(--vp-c-border, #ccc)",
              borderRadius: 6,
              background: "transparent",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            Close
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
