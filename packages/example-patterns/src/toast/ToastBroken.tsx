import { useState } from "react";

import type { ToastExampleProps } from "./types.js";

// Hand-rolled "broken" toast. Deliberately wrong on two axes:
//
//   1. NO role="status" / aria-live. The toast appears visually but
//      screen readers are never told. A blind user gets zero feedback
//      from the action — they have no way to know whether anything
//      happened.
//
//   2. NO aria-atomic. Even if a reader inferred this was a status
//      area (e.g. by finding it after the fact via region nav), only
//      partial updates would be announced as content changes — not
//      the full toast contents.
//
// Visually identical to ToastCorrect — same toast card, same
// positioning. Just no AT signal.
export function ToastBroken({
  trigger,
  title,
  description,
}: ToastExampleProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
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
        <div
          style={{
            position: "fixed",
            bottom: 16,
            right: 16,
            width: 320,
            maxWidth: "calc(100vw - 32px)",
            background: "var(--vp-c-bg-elv, #fff)",
            border: "1px solid var(--vp-c-border, #ccc)",
            borderRadius: 6,
            padding: 12,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
            zIndex: 9999,
          }}
        >
          <div style={{ fontWeight: 600 }}>{title}</div>
          {description ? (
            <div style={{ color: "var(--vp-c-text-2)" }}>{description}</div>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              marginTop: 8,
              padding: "4px 8px",
              border: "1px solid var(--vp-c-border, #ccc)",
              borderRadius: 4,
              background: "transparent",
              cursor: "pointer",
              font: "inherit",
              fontSize: "0.85em",
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </>
  );
}
