export interface SliderExampleProps {
  /** Visible label rendered via `aria-label` on the slider. */
  label: string;
  /** Initial value, between `min` and `max`. */
  defaultValue: number;
  min?: number;
  max?: number;
  step?: number;
}
