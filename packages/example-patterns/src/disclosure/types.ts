import type { ReactNode } from "react";

export interface DisclosureExampleProps {
  /** Visible label of the trigger button. */
  trigger: string;
  /** Panel content shown when expanded. */
  children: ReactNode;
  /** Whether the disclosure starts expanded. */
  defaultOpen?: boolean;
}
