import { useId } from "react";

import type { ChartExampleProps } from "./types.js";

// Correct chart. Gives the SVG a real text alternative plus a
// screen-reader-only data table so AT users can read the actual
// values, not just the summary:
//
//   - `role="img"` on the <svg> — the browser otherwise exposes the
//     SVG as a "graphics-document" or as loose <g>/<path> children,
//     which is meaningless to AT.
//   - `<title>` + `<desc>` referenced by `aria-labelledby` and
//     `aria-describedby` — the short accessible name and the long
//     description. Both are inside the SVG so they travel with it.
//   - An sr-only `<table>` alternative — the underlying data as a
//     real accessibility tree table, so AT users can read individual
//     values. WCAG 1.1.1 Non-text Content, done properly.
//
// Inspecting this surfaces the labeled image node + the parallel
// table structure; the visualization is announced with a real name
// AND its data is reachable.
export function ChartCorrect({
  title,
  description,
  data,
  unit,
}: ChartExampleProps) {
  const titleId = useId();
  const descId = useId();
  const width = 320;
  const height = 160;
  const padding = 24;
  const max = Math.max(...data.map((d) => d.value), 1);
  const barWidth = (width - padding * 2) / data.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <svg
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descId}
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
        <title id={titleId}>{title}</title>
        <desc id={descId}>{description}</desc>
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

      {/* Sr-only table alternative — visible to AT, clipped visually. */}
      <table
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        <caption>{title} — underlying data</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Value{unit ? ` (${unit})` : ""}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.id}>
              <th scope="row">{d.label}</th>
              <td>{d.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
