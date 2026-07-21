export interface MultiStepFormStepDef {
  /** Stable id used as a React key. */
  id: string;
  /** Visible step name in the progress indicator + legend. */
  label: string;
}

export interface MultiStepFormExampleProps {
  /** Step definitions rendered in the progress list. */
  steps: MultiStepFormStepDef[];
  /** Optional starting step index (0-based). */
  initialStepIndex?: number;
}
