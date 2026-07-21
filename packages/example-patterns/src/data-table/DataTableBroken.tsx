import type { DataTableExampleProps } from "./types.js";

// Hand-rolled "broken" data table. Deliberately wrong on the entire
// table role hierarchy:
//
//   1. NO <table> — the container is a <div> grid. AT announces a
//      generic block, not a table; navigation-by-cell / by-column /
//      by-row shortcuts don't work.
//
//   2. NO <caption> — the table has no accessible name at all.
//
//   3. NO <th scope="col"> / <th scope="row"> — headers are styled
//      <div>s with bold text. Screen readers don't announce the
//      column / row header when reading each cell, so cells are
//      just orphaned strings.
//
//   4. NO <thead> / <tbody> segmentation — nothing distinguishes
//      the header row from data rows to AT.
//
// Visually identical to the correct variant — same grid layout,
// same bold headers, same alternating cell padding — but the entire
// table structure is invisible to AT.
export function DataTableBroken({
  caption: _caption,
  columns,
  rows,
}: DataTableExampleProps) {
  const gridCols = `repeat(${columns.length}, minmax(0, 1fr))`;

  return (
    <div
      style={{
        border: "1px solid var(--vp-c-border, #ccc)",
        borderRadius: 6,
        background: "var(--vp-c-bg-elv, #fff)",
        font: "inherit",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: gridCols,
          background: "var(--vp-c-default-soft, rgba(0,0,0,0.03))",
          borderBottom: "1px solid var(--vp-c-border, #ccc)",
        }}
      >
        {columns.map((col) => (
          <div
            key={col.id}
            style={{
              padding: "6px 10px",
              fontWeight: 600,
            }}
          >
            {col.label}
          </div>
        ))}
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          style={{
            display: "grid",
            gridTemplateColumns: gridCols,
            borderBottom: "1px solid var(--vp-c-border, #eee)",
          }}
        >
          {columns.map((col) => (
            <div key={col.id} style={{ padding: "6px 10px" }}>
              {row.cells[col.id] ?? ""}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
