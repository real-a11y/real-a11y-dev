export interface ListboxOptionDef {
  /** Stable id used as a React key and the option's value. */
  id: string;
  /** Visible label of the option. */
  label: string;
}

export interface ListboxExampleProps {
  /** Accessible name of the listbox. */
  label: string;
  /** Options rendered inside the listbox. */
  options: ListboxOptionDef[];
  /** Id of the initially-selected option, if any. */
  defaultSelectedId?: string;
}
