import type { DataTableExampleProps } from "./types.js";

// Correct data table. Uses native HTML table semantics:
//   - <table> emits role="table" implicitly
//   - <caption> is the table's accessible name (announced when a
//     screen reader lands on the table)
//   - <thead>/<tbody> segment header rows from data rows
//   - <th scope="col"> marks the column-header row
//   - <th scope="row"> marks the row-header column (usually the
//     leftmost cell — a unique identifier for the row). Screen
//     readers announce the row/column header when reading each cell.
//   - <td> for data cells
//
// Inspecting this shows the full `table > rowgroup > row > columnheader/rowheader/cell`
// tree, which is what makes navigation-by-header work in VoiceOver/JAWS.
export function DataTableCorrect({
  caption,
  columns,
  rows,
  rowHeaderColumnId,
}: DataTableExampleProps) {
  const rowHeaderId = rowHeaderColumnId ?? columns[0]?.id;

  return (
    <table
      style={{
        borderCollapse: "collapse",
        width: "100%",
        border: "1px solid var(--vp-c-border, #ccc)",
        background: "var(--vp-c-bg-elv, #fff)",
        font: "inherit",
      }}
    >
      <caption
        style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600 }}
      >
        {caption}
      </caption>
      <thead>
        <tr>
          {columns.map((col) => (
            <th
              key={col.id}
              scope="col"
              style={{
                textAlign: "left",
                padding: "6px 10px",
                borderBottom: "1px solid var(--vp-c-border, #ccc)",
                background: "var(--vp-c-default-soft, rgba(0,0,0,0.03))",
              }}
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            {columns.map((col) =>
              col.id === rowHeaderId ? (
                <th
                  key={col.id}
                  scope="row"
                  style={{
                    textAlign: "left",
                    padding: "6px 10px",
                    borderBottom: "1px solid var(--vp-c-border, #eee)",
                    fontWeight: 600,
                  }}
                >
                  {row.cells[col.id] ?? ""}
                </th>
              ) : (
                <td
                  key={col.id}
                  style={{
                    padding: "6px 10px",
                    borderBottom: "1px solid var(--vp-c-border, #eee)",
                  }}
                >
                  {row.cells[col.id] ?? ""}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
