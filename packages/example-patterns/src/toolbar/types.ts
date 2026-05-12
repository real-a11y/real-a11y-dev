export interface ToolbarItem {
  /** Stable id used as a React key. */
  id: string;
  /** Visible label of the toolbar button. */
  label: string;
}

export interface ToolbarExampleProps {
  /** Accessible name of the toolbar. */
  label: string;
  /** Toolbar items rendered as buttons. */
  items: ToolbarItem[];
}
