/**
 * Roles of a `<table>`'s required structural children (`thead`, `tbody`,
 * `tfoot`, `tr`, `th`, `td`).
 */

import { safeTagName } from "./clobber-safe.js";
import { flatParentElement } from "./flat-tree.js";

type RoleResolver = string | ((el: Element) => string);

export function thHeaderRole(el: Element): string {
  // An explicit scope decides on its own; colgroup/rowgroup scope the same
  // axis as col/row for role purposes.
  const scope = el.getAttribute("scope");
  if (scope === "col" || scope === "colgroup") return "columnheader";
  if (scope === "row" || scope === "rowgroup") return "rowheader";

  // No scope: HTML-AAM's auto algorithm looks at where the cell sits. A
  // header row (<thead>, or the table's first row when there is no <thead>)
  // labels columns; anything else labels its row. Ancestor walk only — no
  // layout reads.
  // eslint-disable-next-line no-restricted-properties -- one read, and a <th> is never a form
  const row = el.parentElement;
  if (!row || safeTagName(row) !== "tr") return "rowheader";

  // eslint-disable-next-line no-restricted-properties -- one read, and `row` is a <tr> by the check above
  const section = row.parentElement;
  if (section && safeTagName(section) === "thead") return "columnheader";

  // Otherwise only the table's very first row heads columns. When a <thead>
  // exists its row wins that check, so a <th> leading a body row stays a
  // rowheader (the "Name | Ada" leading-cell pattern). A <tr> always precedes
  // its own descendants in document order, so a nested table can't win here.
  const table = row.closest("table");
  return table && row === table.querySelector("tr")
    ? "columnheader"
    : "rowheader";
}

/**
 * Role of a table part.
 *
 * WAI-ARIA 1.2 (`presentation`): the implicit native semantics of a
 * presentational table's thead/tbody/tfoot/tr/th/td are removed with the
 * table's own, so the extractor flattens them and promotes their text. Only
 * the nearest owning table counts, so a nested data table stays intact.
 * `isPresentational` decides for that table and part; it is injected because
 * it needs role resolution, which lives in role-map. An authored role never
 * reaches a resolver.
 */
export function tablePartRole(
  el: Element,
  implicit: RoleResolver,
  isPresentational: (table: Element, part: Element) => boolean,
): string {
  let table = flatParentElement(el);
  while (table && safeTagName(table) !== "table") {
    table = flatParentElement(table);
  }
  if (table && isPresentational(table, el)) return "presentation";
  return typeof implicit === "string" ? implicit : implicit(el);
}
