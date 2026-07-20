export interface DataTableRowDef {
  /** Stable id used as a React key. */
  id: string;
  /** Cell values keyed by column id. */
  cells: Record<string, string>;
}

export interface DataTableColumnDef {
  /** Stable id used as a React key + cells lookup. */
  id: string;
  /** Visible column header text. */
  label: string;
}

export interface DataTableExampleProps {
  /** Table caption shown above / used as the accessible name. */
  caption: string;
  /** Column definitions rendered as headers. */
  columns: DataTableColumnDef[];
  /** Data rows. */
  rows: DataTableRowDef[];
  /** Optional id of the column whose header cell should mark rows (`th scope="row"`). Defaults to the first column. */
  rowHeaderColumnId?: string;
}
