export interface ListboxMultiOptionDef {
  /** Stable id used as a React key and the option's value. */
  id: string;
  /** Visible label of the option. */
  label: string;
}

export interface ListboxMultiExampleProps {
  /** Accessible name of the listbox. */
  label: string;
  /** Options available for multi-selection. */
  options: ListboxMultiOptionDef[];
  /** Ids of options that start selected. */
  defaultSelectedIds?: string[];
}
