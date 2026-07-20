import * as React from "react";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ChartBroken, ChartCorrect } from "@real-a11y-dev/example-patterns";

afterEach(cleanup);

const data = [
  { id: "jan", label: "Jan", value: 12 },
  { id: "feb", label: "Feb", value: 18 },
  { id: "mar", label: "Mar", value: 9 },
];

describe("Content pattern: Chart — correct vs broken", () => {
  it("correct chart labels the svg with role=img + title + desc + sr-only data table", () => {
    const { container } = render(
      <ChartCorrect
        title="Monthly revenue"
        description="Revenue rose in February, dipped in March."
        data={data}
        unit="USD"
      />,
    );

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-labelledby")).toBeTruthy();
    expect(svg?.getAttribute("aria-describedby")).toBeTruthy();

    expect(container.querySelector("title")?.textContent).toBe(
      "Monthly revenue",
    );
    expect(container.querySelector("desc")?.textContent).toContain("February");

    // Sr-only alternative table with each value.
    const cells = container.querySelectorAll("table td");
    const cellValues = [...cells].map((c) => c.textContent);
    expect(cellValues).toEqual(["12", "18", "9"]);
  });

  it("broken chart has no role, no title/desc, no alternative", () => {
    const { container } = render(
      <ChartBroken
        title="Monthly revenue"
        description="Revenue rose in February, dipped in March."
        data={data}
      />,
    );

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("role")).toBeNull();
    expect(svg?.getAttribute("aria-labelledby")).toBeNull();
    expect(container.querySelector("title")).toBeNull();
    expect(container.querySelector("desc")).toBeNull();
    expect(container.querySelector("table")).toBeNull();
  });
});
