// Shared shape between TabsCorrect and TabsBroken so the example apps
// can swap one for the other without changing call-site props.
export interface TabPanel {
  /** Stable id used for the tab + panel relationship. */
  id: string;
  /** Visible label of the tab trigger. */
  label: string;
  /** Panel content for this tab. */
  content: React.ReactNode;
}

export interface TabsExampleProps {
  /** ID of the panel that should be open initially. */
  defaultValue: string;
  /** Tab + panel definitions. */
  panels: TabPanel[];
  /** Optional aria-label for the tablist. */
  label?: string;
}
