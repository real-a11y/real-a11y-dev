import type { TargetCandidate } from "@real-a11y-dev/browser";
import { describe, expect, it } from "vitest";

import { CliError } from "../exit.js";

import { actionableTarget, stepsFromFlags, sugarStep } from "./interact.js";

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

describe("actionableTarget", () => {
  const step = { verb: "click", role: "button", name: "Save" } as const;
  const candidate = (over: Partial<TargetCandidate> = {}): TargetCandidate => ({
    nth: 1,
    role: "button",
    name: "Save",
    actionable: true,
    disabled: false,
    ...over,
  });

  /** The CliError a resolution throws, so message and hint can be compared. */
  function refusal(resolved: Parameters<typeof actionableTarget>[0]) {
    try {
      actionableTarget(resolved, step);
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      const { message, hint } = err as CliError;
      return { message, hint };
    }
    throw new Error("expected a refusal");
  }

  it("returns the node id of a resolved, enabled target", () => {
    expect(
      actionableTarget(
        { kind: "resolved", nodeId: "ax-dom-7", candidate: candidate() },
        step,
      ),
    ).toBe("ax-dom-7");
  });

  it("explains a miss, pointing at same-role nodes when there are some", () => {
    expect(refusal({ kind: "not-found", matchesForRole: 2 })).toEqual({
      message: `no button "Save" in the page's accessibility tree`,
      hint: "2 button(s) are present under a different name — see them with: real-a11y tree <url>",
    });
    expect(refusal({ kind: "not-found", matchesForRole: 0 })).toEqual({
      message: `no button "Save" in the page's accessibility tree`,
      hint: "check what the page actually exposes: real-a11y tree <url>",
    });
  });

  it("refuses an nth past the last match", () => {
    expect(
      refusal({ kind: "nth-out-of-range", nth: 3, matchCount: 2 }),
    ).toEqual({
      message: `nth=3, but only 2 node(s) match button "Save"`,
      hint: undefined,
    });
  });

  it("lists at most ten ambiguous candidates and counts the rest", () => {
    const candidates = Array.from({ length: 12 }, (_, i) =>
      candidate({ nth: i + 1, disabled: i === 1 }),
    );
    const { message, hint } = refusal({ kind: "ambiguous", candidates });
    const lines = message.split("\n");
    expect(lines[0]).toBe(`12 nodes match button "Save":`);
    expect(lines[1]).toBe(`    nth=1 · button "Save"`);
    expect(lines[2]).toBe(`    nth=2 · button "Save" (disabled)`);
    expect(lines[10]).toBe(`    nth=10 · button "Save"`);
    expect(lines[11]).toBe("    … +2 more");
    expect(lines).toHaveLength(12);
    expect(hint).toBe("add nth=<n> to the step (1-based, document order)");
  });

  it("refuses a node with no backing DOM element", () => {
    expect(
      refusal({
        kind: "no-dom-node",
        candidate: candidate({ role: "RootWebArea", name: "Page" }),
      }),
    ).toEqual({
      message: `matched RootWebArea "Page", but it has no backing DOM element (a synthesized node) — it can't be acted on`,
      hint: undefined,
    });
  });

  it("refuses a disabled target, naming the verb it would ignore", () => {
    expect(
      refusal({
        kind: "resolved",
        nodeId: "ax-dom-7",
        candidate: candidate({ disabled: true }),
      }),
    ).toEqual({
      message: `button "Save" is disabled — the page would ignore the click`,
      hint: "act on whatever enables it first, if that's the point of the flow",
    });
  });
});
