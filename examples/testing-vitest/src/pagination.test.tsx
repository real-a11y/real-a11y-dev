import * as React from "react";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  PaginationBroken,
  PaginationCorrect,
} from "@real-a11y-dev/example-patterns";

afterEach(cleanup);

describe("Content pattern: Pagination — correct vs broken", () => {
  it("correct pagination is a named nav landmark with aria-current='page' on the active button", () => {
    const { container } = render(
      <PaginationCorrect currentPage={3} totalPages={5} />,
    );

    const nav = container.querySelector("nav");
    expect(nav).not.toBeNull();
    expect(nav?.getAttribute("aria-label")).toBe("Pagination");

    const current = container.querySelector('[aria-current="page"]');
    expect(current).not.toBeNull();
    expect(current?.textContent).toBe("3");

    // Every page button carries a full aria-label with the word "Page".
    const pageButtons = container.querySelectorAll(
      "nav button[aria-label^='Page ']",
    );
    expect(pageButtons.length).toBe(5);
  });

  it("broken pagination has no nav landmark and no aria-current", () => {
    const { container } = render(
      <PaginationBroken currentPage={3} totalPages={5} />,
    );

    expect(container.querySelector("nav")).toBeNull();
    expect(container.querySelector("[aria-current]")).toBeNull();
    // Buttons render, just without the aria-label / landmark story.
    expect(container.querySelectorAll("button").length).toBeGreaterThan(0);
  });
});
