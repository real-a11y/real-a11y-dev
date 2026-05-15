import { useEffect, useRef, useState } from "react";

import type { DialogExampleProps } from "./types.js";

// Hand-rolled "broken" modal dialog. Deliberately wrong on four axes:
//
//   1. NO role="dialog" or aria-modal="true" on the panel. Just a
//      plain `<div>`. To AT, it reads as part of the page flow, not a
//      modal — the inspector's modality tracker never recognises it.
//
//   2. NO aria-labelledby / aria-describedby on the panel. Even if a
//      reader figured out it was a dialog, they'd have no announced
//      name or description.
//
//   3. NO focus trap. Tab moves focus into and right back out of the
//      dialog to whatever's underneath. Tab-sequence snapshot proves
//      it: continues from the trigger straight to whatever's after
//      the dialog in the document, not the dialog's close button.
//
//   4. NO return-focus on close. Closing the dialog leaves focus on
//      `<body>` instead of returning it to the trigger. WCAG 2.4.3
//      (Focus Order) violation.
export function DialogBroken({
  trigger,
  title,
  description,
  children,
}: DialogExampleProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Note: no Escape handler either — adding one would partially
  // mitigate (1) above. Left out so the broken variant is broken on
  // every keyboard axis a screen-reader user would expect.
  useEffect(() => {
    // Intentionally empty — illustrates the absence of any focus or
    // escape behavior wiring.
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
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
      </button>
      {open ? (
        <div>
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.4)",
            }}
            onClick={() => setOpen(false)}
          />
          <div
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
            <h3 style={{ margin: 0, fontSize: "1.125rem" }}>{title}</h3>
            {description ? (
              <p style={{ marginTop: 4, color: "var(--vp-c-text-2)" }}>
                {description}
              </p>
            ) : null}
            <div style={{ marginTop: 16 }}>{children}</div>
            <button
              type="button"
              onClick={() => setOpen(false)}
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
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
