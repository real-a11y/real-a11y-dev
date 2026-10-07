import { describe, expect, it } from "vitest";

import { isJumpKey, nextJump, type JumpCycle } from "./jump-keys.js";

const CONTROLS: Record<string, string[]> = { tabs: ["p1", "p2", "p3"] };
const CONTROLLED_BY: Record<string, string[]> = {
  p1: ["tabs"],
  p2: ["tabs"],
  p3: ["tabs"],
};
const controlsOf = (id: string) => CONTROLS[id] ?? [];
const controlledBy = (id: string) => CONTROLLED_BY[id] ?? [];

describe("nextJump", () => {
  it("follows a row's first link, then cycles through the rest, wrapping", () => {
    let cycle: JumpCycle | null = null;
    let at = "tabs";
    const visited: string[] = [];
    for (let i = 0; i < 4; i++) {
      const next: { target: string; cycle: JumpCycle | null } = nextJump(
        at,
        cycle,
        false,
        controlsOf,
        controlledBy,
      )!;
      at = next.target;
      cycle = next.cycle;
      visited.push(at);
    }
    expect(visited).toEqual(["p1", "p2", "p3", "p1"]);
  });

  it("goes back to the origin from a row a jump landed on", () => {
    const first = nextJump("tabs", null, false, controlsOf, controlledBy)!;
    const second = nextJump(
      "p1",
      first.cycle,
      false,
      controlsOf,
      controlledBy,
    )!;
    expect(
      nextJump("p2", second.cycle, true, controlsOf, controlledBy),
    ).toEqual({ target: "tabs", cycle: null });
  });

  it("goes to the first controller from anywhere else", () => {
    expect(nextJump("p3", null, true, controlsOf, controlledBy)).toEqual({
      target: "tabs",
      cycle: null,
    });
  });

  it("starts afresh once the selection has left the cycle", () => {
    const first = nextJump("tabs", null, false, controlsOf, controlledBy)!;
    expect(
      nextJump("elsewhere", first.cycle, false, controlsOf, controlledBy),
    ).toBeNull();
  });
});

describe("isJumpKey", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("takes Alt+J by its physical key, and by its character", () => {
    expect(isJumpKey(key({ altKey: true, code: "KeyJ", key: "∆" }))).toBe(true);
    // The key labelled J on Dvorak sits where QWERTY has C.
    expect(isJumpKey(key({ altKey: true, code: "KeyC", key: "j" }))).toBe(true);
    expect(
      isJumpKey(key({ altKey: true, shiftKey: true, code: "KeyJ", key: "J" })),
    ).toBe(true);
  });

  it("leaves J alone without Alt, or with Ctrl or Cmd", () => {
    expect(isJumpKey(key({ code: "KeyJ", key: "j" }))).toBe(false);
    expect(
      isJumpKey(key({ altKey: true, ctrlKey: true, code: "KeyJ", key: "j" })),
    ).toBe(false);
    expect(
      isJumpKey(key({ altKey: true, metaKey: true, code: "KeyJ", key: "j" })),
    ).toBe(false);
  });
});
