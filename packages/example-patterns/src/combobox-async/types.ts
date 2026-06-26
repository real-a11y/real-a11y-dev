export interface ComboboxAsyncOptionDef {
  /** Stable id used as a React key and the option's value. */
  id: string;
  /** Visible label of the option. */
  label: string;
}

export interface ComboboxAsyncExampleProps {
  /** Accessible label of the combobox. */
  label: string;
  /** Optional placeholder shown when the input is empty. */
  placeholder?: string;
  /** Simulated network latency in ms. Defaults to 600. */
  latencyMs?: number;
}
