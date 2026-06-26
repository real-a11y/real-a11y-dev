import { useState } from "react";

import type { DialogNestedExampleProps } from "./types.js";

// Hand-rolled "broken" nested Dialog. The role chain on each card
// looks superficially correct (role="dialog" + aria-modal="true"),
// but the *stacking* and *focus management* are wrong:
//
//   1. NO focus trap. Tab moves freely through any element on the
//      page, including the outer dialog and the page behind both.
//
//   2. NO focus stack on close. Closing the inner dialog drops focus
//      to <body> instead of returning to the inner trigger. Closing
//      the outer drops focus to <body> instead of the outer trigger.
//
//   3. NO Escape handling. Both dialogs stay open until the user
//      hunts for the close button.
//
//   4. The outer's content is NOT inert while the inner is open —
//      keyboard nav can land back in the outer's body, which is the
//      whole reason modal scopes exist.
//
// Visually similar to the correct variant — same card layout,
// same nested trigger — but the modal-stack semantics are missing.
export function DialogNestedBroken({
  outerTrigger,
  outerTitle,
  innerTrigger,
  innerTitle,
}: DialogNestedExampleProps) {
  const [outerOpen, setOuterOpen] = useState(false);
  const [innerOpen, setInnerOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOuterOpen(true)}
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
      </button>

      {outerOpen ? (
        <>
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.4)",
              zIndex: 40,
            }}
            onClick={() => setOuterOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={outerTitle}
            style={{
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
            }}
          >
            <h3 style={{ marginBottom: 8 }}>{outerTitle}</h3>
            <p style={{ color: "#666", marginBottom: 16 }}>
              This nested set looks like the correct one, but Tab leaks out of
              the dialog and Escape does nothing.
            </p>

            <button
              type="button"
              onClick={() => setInnerOpen(true)}
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
            </button>

            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setOuterOpen(false)}
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
              </button>
            </div>
          </div>
        </>
      ) : null}

      {innerOpen ? (
        <>
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.4)",
              zIndex: 60,
            }}
            onClick={() => setInnerOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={innerTitle}
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "var(--vp-c-bg-elv, #fff)",
              border: "1px solid var(--vp-c-border, #ccc)",
              borderRadius: 8,
              padding: 24,
              maxWidth: 360,
              width: "90%",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.2)",
              zIndex: 70,
            }}
          >
            <h3 style={{ marginBottom: 8 }}>{innerTitle}</h3>
            <p style={{ color: "#666", marginBottom: 16 }}>
              Closing this returns focus to <code>&lt;body&gt;</code>, not the
              trigger inside the outer dialog.
            </p>
            <button
              type="button"
              onClick={() => setInnerOpen(false)}
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
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
