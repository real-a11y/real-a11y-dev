import { describe, it, expect } from "vitest";

import { resolveStepperKeyAction } from "./stepperKeys.js";

function key(
  k: string,
  mods: { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean } = {},
): KeyboardEvent {
  return {
    key: k,
    shiftKey: !!mods.shift,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
    metaKey: !!mods.meta,
  } as KeyboardEvent;
}

const STEPPER = ["increment", "decrement"] as const;
const BUTTON = ["click"] as const;

describe("resolveStepperKeyAction", () => {
  it("maps +/= to increment and -/_ to decrement when both actions exist", () => {
    expect(resolveStepperKeyAction(key("+"), STEPPER)).toBe("increment");
    expect(resolveStepperKeyAction(key("="), STEPPER)).toBe("increment");
    expect(resolveStepperKeyAction(key("-"), STEPPER)).toBe("decrement");
    expect(resolveStepperKeyAction(key("_"), STEPPER)).toBe("decrement");
  });

  it("maps Shift+Enter to decrement (plain Enter is left for getPrimaryAction)", () => {
    expect(
      resolveStepperKeyAction(key("Enter", { shift: true }), STEPPER),
    ).toBe("decrement");
    expect(resolveStepperKeyAction(key("Enter"), STEPPER)).toBeNull();
  });

  it("returns null when the node has no matching step action", () => {
    expect(resolveStepperKeyAction(key("+"), BUTTON)).toBeNull();
    expect(resolveStepperKeyAction(key("-"), BUTTON)).toBeNull();
    expect(
      resolveStepperKeyAction(key("Enter", { shift: true }), BUTTON),
    ).toBeNull();
    expect(resolveStepperKeyAction(key("-"), ["increment"])).toBeNull();
    expect(resolveStepperKeyAction(key("+"), ["decrement"])).toBeNull();
  });

  it("ignores ctrl/alt/meta combinations", () => {
    expect(
      resolveStepperKeyAction(key("+", { ctrl: true }), STEPPER),
    ).toBeNull();
    expect(
      resolveStepperKeyAction(key("-", { alt: true }), STEPPER),
    ).toBeNull();
    expect(
      resolveStepperKeyAction(
        key("Enter", { shift: true, meta: true }),
        STEPPER,
      ),
    ).toBeNull();
  });
});
