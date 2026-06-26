import * as Dialog from "@radix-ui/react-dialog";

import type { DialogNestedExampleProps } from "./types.js";

// Correct APG nested Dialog. Radix natively supports stacking modal
// dialogs and gives this pattern correctly:
//
//   - Each <Dialog.Content> emits role="dialog" + aria-modal="true"
//     + aria-labelledby pointing at its own title. Both dialogs are
//     present in the AT tree at once when stacked.
//   - Focus moves into the inner dialog on open; Escape closes the
//     inner first, restoring focus to the inner trigger inside the
//     outer dialog; Escape again closes the outer, restoring focus
//     to the outer trigger.
//   - Each dialog's overlay disables interaction with content
//     behind it (the inert "modal scope" semantics).
//   - The portal escapes the outer dialog's stacking context so the
//     inner dialog can render above its parent.
//
// Real A11y consumers see the modal stack in the panel — when the
// inner is open, the active modal is the inner one (most-recent
// aria-modal="true"); closing it falls back to the outer.
const dialogContentStyle: React.CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  background: "var(--vp-c-bg-elv, #fff)",
  border: "1px solid var(--vp-c-border, #ccc)",
  borderRadius: 8,
  padding: 24,
  maxWidth: 420,
  width: "90%",
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.2)",
  zIndex: 50,
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.4)",
  zIndex: 40,
};

export function DialogNestedCorrect({
  outerTrigger,
  outerTitle,
  innerTrigger,
  innerTitle,
}: DialogNestedExampleProps) {
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
        {outerTrigger}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay style={overlayStyle} />
        <Dialog.Content style={dialogContentStyle}>
          <Dialog.Title style={{ marginBottom: 8 }}>{outerTitle}</Dialog.Title>
          <Dialog.Description style={{ color: "#666", marginBottom: 16 }}>
            The outer dialog stays in the modal stack while the inner one is
            open. Closing the inner returns focus here; closing again returns
            focus to the original trigger.
          </Dialog.Description>

          {/* Nested dialog — Radix manages the focus stack and the
              ordering of aria-modal scopes. */}
          <Dialog.Root>
            <Dialog.Trigger
              style={{
                padding: "6px 12px",
                border: "1px solid var(--vp-c-border, #2e79ff)",
                borderRadius: 6,
                background: "var(--vp-c-brand, #2e79ff)",
                color: "#fff",
                cursor: "pointer",
                font: "inherit",
              }}
            >
              {innerTrigger}
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay style={{ ...overlayStyle, zIndex: 60 }} />
              <Dialog.Content
                style={{
                  ...dialogContentStyle,
                  zIndex: 70,
                  maxWidth: 360,
                }}
              >
                <Dialog.Title style={{ marginBottom: 8 }}>
                  {innerTitle}
                </Dialog.Title>
                <Dialog.Description style={{ color: "#666", marginBottom: 16 }}>
                  This dialog is rendered into a separate portal stacked above
                  the outer one. Both <code>aria-modal=&quot;true&quot;</code>{" "}
                  scopes coexist; the inner is the active one.
                </Dialog.Description>
                <Dialog.Close
                  style={{
                    padding: "6px 12px",
                    border: "1px solid var(--vp-c-border, #ccc)",
                    borderRadius: 6,
                    background: "transparent",
                    cursor: "pointer",
                    font: "inherit",
                  }}
                >
                  Close inner
                </Dialog.Close>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>

          <div style={{ marginTop: 16 }}>
            <Dialog.Close
              style={{
                padding: "6px 12px",
                border: "1px solid var(--vp-c-border, #ccc)",
                borderRadius: 6,
                background: "transparent",
                cursor: "pointer",
                font: "inherit",
              }}
            >
              Close outer
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
