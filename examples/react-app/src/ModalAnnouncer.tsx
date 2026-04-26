import type { RefObject } from "react";
import { useActiveModal } from "@real-a11y-dev/react";

interface Props {
  rootRef: RefObject<Element | null>;
}

/**
 * Announces the currently open modal dialog to screen reader users
 * via an aria-live region.
 */
export function ModalAnnouncer({ rootRef }: Props) {
  const modal = useActiveModal(rootRef);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      // Visually hidden, but readable by screen readers
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        overflow: "hidden",
        clip: "rect(0,0,0,0)",
        whiteSpace: "nowrap",
      }}
    >
      {modal ? `Dialog opened: ${modal.a11y.name || "unnamed dialog"}` : ""}
    </div>
  );
}
