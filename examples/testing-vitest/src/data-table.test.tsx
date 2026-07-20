import * as React from "react";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  DataTableBroken,
  DataTableCorrect,
} from "@real-a11y-dev/example-patterns";

afterEach(cleanup);

const columns = [
  { id: "name", label: "Name" },
  { id: "role", label: "Role" },
  { id: "team", label: "Team" },
];
const rows = [
  { id: "1", cells: { name: "Ada", role: "Engineer", team: "Platform" } },
  { id: "2", cells: { name: "Grace", role: "Manager", team: "Runtime" } },
];

describe("Content pattern: Data table — correct vs broken", () => {
  it("correct table exposes <caption>, column headers with scope, and row headers", () => {
    const { container } = render(
      <DataTableCorrect caption="Team roster" columns={columns} rows={rows} />,
    );

    const table = container.querySelector("table");
    expect(table).not.toBeNull();

    const caption = container.querySelector("caption");
    expect(caption?.textContent).toBe("Team roster");

    const colHeaders = container.querySelectorAll('th[scope="col"]');
    expect(colHeaders.length).toBe(3);

    // First column (name) is the row header per default rowHeaderColumnId.
    const rowHeaders = container.querySelectorAll('th[scope="row"]');
    expect(rowHeaders.length).toBe(2);
    expect(rowHeaders[0].textContent).toBe("Ada");
  });

  it("broken table renders as a div grid with no <table>, no <caption>, no <th>", () => {
    const { container } = render(
      <DataTableBroken caption="Team roster" columns={columns} rows={rows} />,
    );

    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("caption")).toBeNull();
    expect(container.querySelector("th")).toBeNull();
    expect(container.querySelector('[scope="col"]')).toBeNull();
  });
});
