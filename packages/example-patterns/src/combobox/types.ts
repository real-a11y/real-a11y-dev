export interface ComboboxOptionDef {
  /** Stable id used as a React key and the option's value. */
  id: string;
  /** Visible label of the option. */
  label: string;
}

export interface ComboboxExampleProps {
  /** Accessible label of the combobox. */
  label: string;
  /** Options available for filtering / selection. */
  options: ComboboxOptionDef[];
  /** Optional placeholder shown when the input is empty. */
  placeholder?: string;
}
