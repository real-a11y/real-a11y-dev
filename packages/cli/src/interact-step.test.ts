import { describe, expect, it } from "vitest";

import { CliError } from "./exit.js";
import { describeStep, parseStep } from "./interact-step.js";

describe("parseStep", () => {
  it("reads a verb, role, and quoted name", () => {
    expect(parseStep('click button "Save"')).toEqual({
      verb: "click",
      role: "button",
      name: "Save",
    });
  });

  it("treats an omitted name as 'any name' and \"\" as 'unlabeled'", () => {
    // The distinction matters: `""` is how you target the unlabeled control
    // an audit just flagged.
    expect(parseStep("click button")).toEqual({
      verb: "click",
      role: "button",
    });
    expect(parseStep('click button ""')).toEqual({
      verb: "click",
      role: "button",
      name: "",
    });
  });

  it("reads nth= with and without a name", () => {
    expect(parseStep('click button "Save" nth=2')).toEqual({
      verb: "click",
      role: "button",
      name: "Save",
      nth: 2,
    });
    expect(parseStep("click button nth=3")).toEqual({
      verb: "click",
      role: "button",
      nth: 3,
    });
  });

  it("reads a typed value after =", () => {
    expect(parseStep('type textbox "Email" = someone@example.com')).toEqual({
      verb: "type",
      role: "textbox",
      name: "Email",
      text: "someone@example.com",
    });
  });

  it("keeps everything after the first = as the literal value", () => {
    // Query strings and base64 carry `=`; requiring an escape would be a trap.
    const step = parseStep('type textbox "Q" = a=1&b==2');
    expect(step.text).toBe("a=1&b==2");
  });

  it("does not mistake a value that starts with nth= for a selector", () => {
    const step = parseStep('type textbox "Q" = nth=4');
    expect(step).toEqual({
      verb: "type",
      role: "textbox",
      name: "Q",
      text: "nth=4",
    });
  });

  it("honors escaped quotes inside a name", () => {
    expect(parseStep('click button "Say \\"hi\\""')).toEqual({
      verb: "click",
      role: "button",
      name: 'Say "hi"',
    });
  });

  it("tolerates surrounding and inner whitespace, and a capitalized verb", () => {
    expect(parseStep('  CLICK   button   "Save"  ')).toEqual({
      verb: "click",
      role: "button",
      name: "Save",
    });
  });

  it("accepts hyphenated roles", () => {
    expect(parseStep('focus menu-item "Open"').role).toBe("menu-item");
  });

  describe("refusals", () => {
    const cases: [string, RegExp][] = [
      ["", /empty --step/],
      ["poke button", /unknown step verb "poke"/],
      ["click", /missing a role/],
      ['click "Save"', /missing a role/],
      ['click button "Save', /unterminated quoted name/],
      ['click button "Save" nth=0', /nth must be a positive whole number/],
      ['click button "Save" nth=x', /nth must be a positive whole number/],
      ['click button "Save" nth=-1', /nth must be a positive whole number/],
      ['type textbox "Email"', /needs a value/],
      ['type textbox "Email" =', /empty value/],
      ['click button "Save" = text', /takes no "= value"/],
      ['focus button "Save" = text', /takes no "= value"/],
      ["click button Save", /unexpected trailing input/],
    ];

    for (const [input, pattern] of cases) {
      it(`rejects ${JSON.stringify(input)}`, () => {
        expect(() => parseStep(input)).toThrow(CliError);
        expect(() => parseStep(input)).toThrow(pattern);
      });
    }

    it("points an unquoted multi-word name at the fix via the hint", () => {
      // The most likely typo — the hint has to name the remedy, not just the
      // rule, or the user retries the same thing. The hint is a separate
      // field CliError renders under the message, so assert it directly.
      let caught: CliError | undefined;
      try {
        parseStep("click button Save now");
      } catch (err) {
        caught = err as CliError;
      }
      expect(caught).toBeInstanceOf(CliError);
      expect(caught?.message).toMatch(/unexpected trailing input/);
      expect(caught?.hint).toMatch(/a name must be quoted/);
    });
  });
});

describe("R1 on the failure path", () => {
  // A malformed `type` step still carries its value. Every message that quotes
  // the offending input has to mask it, or a typo turns a password into a CI
  // log line — the failure path needs the same discipline describeStep applies
  // to the success path.
  const SECRET = "hunter2-lives-here";

  const leaky: [string, string][] = [
    ["unquoted multi-word name", `type textbox My Field = ${SECRET}`],
    ["unterminated quote", `type textbox "Email = ${SECRET}`],
    ["no leading verb token", `"type" textbox = ${SECRET}`],
    ["trailing junk before the value", `type textbox "E" nth=2 x = ${SECRET}`],
  ];

  for (const [label, step] of leaky) {
    it(`masks the value when the step is malformed — ${label}`, () => {
      let caught: CliError | undefined;
      try {
        parseStep(step);
      } catch (err) {
        caught = err as CliError;
      }
      expect(caught, "expected this step to be rejected").toBeInstanceOf(
        CliError,
      );
      expect(caught?.message).not.toContain("hunter2");
      expect(caught?.hint ?? "").not.toContain("hunter2");
      expect(caught?.message).toContain("‹hidden›");
    });
  }

  it("still names the part the user has to fix", () => {
    // Redaction must not cost the diagnosis: the unquoted name is the error,
    // and it stays visible.
    let caught: CliError | undefined;
    try {
      parseStep(`type textbox My Field = ${SECRET}`);
    } catch (err) {
      caught = err as CliError;
    }
    expect(caught?.message).toContain("My Field");
    expect(caught?.hint).toMatch(/a name must be quoted/);
  });

  it("leaves a step with no value untouched", () => {
    expect(() => parseStep("click button Save now")).toThrow(
      /"Save now"/, // nothing to redact — the echo is intact
    );
  });
});

describe("describeStep", () => {
  it("renders the tree's own vocabulary", () => {
    expect(describeStep(parseStep('click button "Save"'))).toBe(
      'click button "Save"',
    );
    expect(describeStep(parseStep("click button nth=2"))).toBe(
      "click button nth=2",
    );
  });

  it("NEVER renders the typed value (R1)", () => {
    const rendered = describeStep(
      parseStep('type textbox "Password" = hunter2-lives-here'),
    );
    expect(rendered).not.toContain("hunter2");
    expect(rendered).toBe('type textbox "Password" = ‹hidden›');
  });
});
