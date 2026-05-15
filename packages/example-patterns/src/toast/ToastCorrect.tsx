import { useState } from "react";

import * as RadixToast from "@radix-ui/react-toast";

import type { ToastExampleProps } from "./types.js";

// Correct APG status message / live region, courtesy of
// @radix-ui/react-toast.
//
// Radix provides:
//   - role="status" (polite live region) on the toast root
//   - aria-live="polite" / aria-atomic="true" — screen readers
//     announce the toast contents when it appears, without
//     interrupting whatever was being read
//   - Focus stays where it was (toast doesn't steal it)
//   - The viewport region itself is role="region" with aria-label
//     so AT users can navigate to it manually
//
// Auditing this shows the toast as a `status "<title>"` row when
// it's open — the live-region role is visible.
export function ToastCorrect({
  trigger,
  title,
  description,
}: ToastExampleProps) {
  const [open, setOpen] = useState(false);

  return (
    <RadixToast.Provider swipeDirection="right">
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

      <RadixToast.Root
        open={open}
        onOpenChange={setOpen}
        style={{
          background: "var(--vp-c-bg-elv, #fff)",
          border: "1px solid var(--vp-c-border, #ccc)",
          borderRadius: 6,
          padding: 12,
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
        }}
      >
        <RadixToast.Title style={{ fontWeight: 600 }}>{title}</RadixToast.Title>
        {description ? (
          <RadixToast.Description style={{ color: "var(--vp-c-text-2)" }}>
            {description}
          </RadixToast.Description>
        ) : null}
      </RadixToast.Root>

      <RadixToast.Viewport
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          width: 320,
          maxWidth: "calc(100vw - 32px)",
          listStyle: "none",
          zIndex: 9999,
        }}
      />
    </RadixToast.Provider>
  );
}
