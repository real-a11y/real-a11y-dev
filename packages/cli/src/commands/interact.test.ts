import { describe, expect, it } from "vitest";

import { CliError } from "../exit.js";

import { stepsFromFlags, sugarStep } from "./interact.js";

describe("stepsFromFlags", () => {
  it("parses repeated --step values in order", () => {
    const steps = stepsFromFlags({
      step: ['click button "One"', 'click button "Two"'],
    } as never);
    expect(steps.map((s) => s.name)).toEqual(["One", "Two"]);
  });

  it("accepts a single --step (parseArgs collapses one value)", () => {
    // `multiple: true` yields an array, but the config-defaults merge can seed
    // a bare string — accept both rather than crash on the seeded shape.
    const steps = stepsFromFlags({ step: 'click button "One"' } as never);
    expect(steps).toHaveLength(1);
    expect(steps[0].role).toBe("button");
  });

  it("refuses a run with no steps, naming the flag", () => {
    expect(() => stepsFromFlags({})).toThrow(CliError);
    expect(() => stepsFromFlags({})).toThrow(/at least one --step/);
  });

  it("propagates a malformed step's error", () => {
    expect(() => stepsFromFlags({ step: ["poke button"] } as never)).toThrow(
      /unknown step verb/,
    );
  });
});

describe("sugarStep", () => {
  it("builds a click step from --role/--name", () => {
    expect(sugarStep("click", { role: "button", name: "Save" })).toEqual({
      verb: "click",
      role: "button",
      name: "Save",
    });
  });

  it("distinguishes an omitted --name from an empty one", () => {
    // `--name ""` is how you target the unlabeled control an audit flagged;
    // omitting it matches any name. They must not collapse.
    expect(sugarStep("click", { role: "button" })).toEqual({
      verb: "click",
      role: "button",
    });
    expect(sugarStep("click", { role: "button", name: "" })).toEqual({
      verb: "click",
      role: "button",
      name: "",
    });
  });

  it("requires --role", () => {
    expect(() => sugarStep("click", {})).toThrow(/click needs --role/);
    expect(() => sugarStep("focus", { role: "   " })).toThrow(
      /focus needs --role/,
    );
  });

  it("requires --text for type and refuses it elsewhere", () => {
    expect(() => sugarStep("type", { role: "textbox" })).toThrow(
      /type needs --text/,
    );
    expect(() => sugarStep("click", { role: "button", text: "nope" })).toThrow(
      /--text applies to `type`, not `click`/,
    );
    expect(() => sugarStep("focus", { role: "button", text: "nope" })).toThrow(
      /--text applies to `type`, not `focus`/,
    );
  });

  it("validates --nth as 1-based", () => {
    expect(sugarStep("click", { role: "button", nth: "2" }).nth).toBe(2);
    for (const bad of ["0", "-1", "x", "1.5"]) {
      expect(() => sugarStep("click", { role: "button", nth: bad })).toThrow(
        /--nth must be a positive whole number/,
      );
    }
  });

  it("carries the typed value through without touching it", () => {
    const step = sugarStep("type", {
      role: "textbox",
      name: "Q",
      text: "a=1&b=2",
    });
    expect(step.text).toBe("a=1&b=2");
  });
});
