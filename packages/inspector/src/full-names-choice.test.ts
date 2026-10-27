import { realmSingleton } from "@real-a11y-dev/core";
import { describe, it, expect, beforeEach } from "vitest";

import {
  fullNamesChoice,
  rememberShowFullNames,
  type FullNamesChoice,
} from "./full-names-choice.js";

describe("fullNamesChoice", () => {
  it("is the one slot every copy of the package in the realm reads", () => {
    // Another copy reaches it by key and shape, not through this module:
    // changing either would quietly stop two copies sharing the choice and
    // the open panels, with every test that goes through the module passing.
    const anotherCopys = realmSingleton<FullNamesChoice>(
      "inspector.full-names-choice",
      "full-names-choice@1",
      () => ({ panels: new Set() }),
    );
    expect(fullNamesChoice()).toBe(anotherCopys);
  });
});

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

  it("surfaces every failing panel's error, not only the first", () => {
    const first = new Error("first");
    const second = new Error("second");
    fullNamesChoice().panels.add(() => {
      throw first;
    });
    fullNamesChoice().panels.add(() => {
      throw second;
    });

    let thrown: unknown;
    try {
      rememberShowFullNames(true);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([first, second]);
  });
});
