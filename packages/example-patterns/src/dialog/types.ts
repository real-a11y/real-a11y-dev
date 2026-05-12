import type { ReactNode } from "react";

export interface DialogExampleProps {
  /** Visible label of the trigger button. */
  trigger: string;
  /** Accessible name of the dialog. */
  title: string;
  /** Optional accessible description (renders below the title). */
  description?: string;
  /** Dialog body content. */
  children: ReactNode;
}
