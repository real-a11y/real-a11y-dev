import { describe, it, expect, beforeEach } from "vitest";

import { fullNamesChoice, rememberShowFullNames } from "./full-names-choice.js";

describe("rememberShowFullNames", () => {
  beforeEach(() => {
    delete fullNamesChoice().on;
    fullNamesChoice().panels.clear();
  });

  it("keeps the choice for the page and renders every open panel with it", () => {
    const rendered: string[] = [];
    fullNamesChoice().panels.add(() => rendered.push("first"));
    fullNamesChoice().panels.add(() => rendered.push("second"));

    rememberShowFullNames(true);
    expect(fullNamesChoice().on).toBe(true);
    expect(rendered).toEqual(["first", "second"]);
  });

  it("renders the rest past a panel that throws, then surfaces its error", () => {
    const rendered: string[] = [];
    fullNamesChoice().panels.add(() => {
      throw new Error("detached");
    });
    fullNamesChoice().panels.add(() => rendered.push("healthy"));

    expect(() => rememberShowFullNames(true)).toThrow("detached");
    expect(rendered).toEqual(["healthy"]);
    expect(fullNamesChoice().on).toBe(true);
  });
});
