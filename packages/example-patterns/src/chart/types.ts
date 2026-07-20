export interface ChartDataPointDef {
  /** Stable id used as a React key. */
  id: string;
  /** X-axis category label (e.g. "Jan"). */
  label: string;
  /** Y-axis numeric value. */
  value: number;
}

export interface ChartExampleProps {
  /** Short accessible name of the chart (e.g. "Monthly revenue"). */
  title: string;
  /** Long-form description of what the chart shows (e.g. trend + notable spikes). */
  description: string;
  /** Data points rendered as bars. */
  data: ChartDataPointDef[];
  /** Y-axis label / units (e.g. "USD"). */
  unit?: string;
}
