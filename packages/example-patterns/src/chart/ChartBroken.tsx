import type { ChartExampleProps } from "./types.js";

// Hand-rolled "broken" chart. Deliberately wrong on the "data
// visualization has to have a text alternative" axis (WCAG 1.1.1):
//
//   1. NO `role="img"` on the <svg> — the browser exposes the raw
//      <g>/<rect> children as generic graphic nodes.
//
//   2. NO <title> or <desc> — the shape has no accessible name and
//      no description. Screen reader users hear "graphic" and
//      nothing about what it's showing.
//
//   3. NO alternative data representation (no sr-only table, no
//      text summary). The underlying values are literally
//      unreachable to AT users.
//
// Visually identical to the correct variant — same bars, same
// colours, same layout — but the entire information payload is
// invisible to anyone not looking at the pixels.
export function ChartBroken({
  title: _title,
  description: _description,
  data,
  unit: _unit,
}: ChartExampleProps) {
  const width = 320;
  const height = 160;
  const padding = 24;
  const max = Math.max(...data.map((d) => d.value), 1);
  const barWidth = (width - padding * 2) / data.length;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{
        width: "100%",
        maxWidth: width,
        height: "auto",
        background: "var(--vp-c-bg-elv, #fff)",
        border: "1px solid var(--vp-c-border, #ccc)",
        borderRadius: 6,
      }}
    >
      {data.map((d, i) => {
        const barHeight = ((d.value / max) * (height - padding * 2)) | 0;
        const x = padding + i * barWidth;
        const y = height - padding - barHeight;
        return (
          <rect
            key={d.id}
            x={x + 4}
            y={y}
            width={Math.max(barWidth - 8, 4)}
            height={barHeight}
            fill="var(--vp-c-brand, #2e79ff)"
            rx={2}
          />
        );
      })}
    </svg>
  );
}
