import { describe, expect, it } from "vitest";

import { isJumpKey, nextJump, type JumpCycle } from "./jumpKeys.js";

const links = {
  forward: new Map([["tabs", ["p1", "p2", "p3"]]]),
  reverse: new Map([
    ["p1", ["tabs"]],
    ["p2", ["tabs", "toggle"]],
    ["p3", ["tabs"]],
  ]),
};
const anywhere = () => true;

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
        links,
        anywhere,
      )!;
      at = next.target;
      cycle = next.cycle;
      visited.push(at);
    }
    expect(visited).toEqual(["p1", "p2", "p3", "p1"]);
  });

  it("goes back to the row the jump came from, not the first controller", () => {
    // p2 is controlled by "tabs" and "toggle"; jumped to from "toggle", back
    // returns to "toggle".
    const cycle: JumpCycle = { origin: "toggle", targets: ["p2"], index: 0 };
    expect(nextJump("p2", cycle, true, links, anywhere)).toEqual({
      target: "toggle",
      cycle: null,
    });
  });

  it("goes to the first controller from anywhere else", () => {
    expect(nextJump("p3", null, true, links, anywhere)).toEqual({
      target: "tabs",
      cycle: null,
    });
  });

  it("starts afresh once the selection has left the cycle", () => {
    const first = nextJump("tabs", null, false, links, anywhere)!;
    expect(
      nextJump("elsewhere", first.cycle, false, links, anywhere),
    ).toBeNull();
  });

  it("skips a row that can't take the jump, either way", () => {
    const gone = (id: string) => id !== "p1" && id !== "tabs";
    expect(nextJump("tabs", null, false, links, gone)?.target).toBe("p2");
    expect(nextJump("p2", null, true, links, gone)?.target).toBe("toggle");
    expect(nextJump("p1", null, true, links, gone)).toBeNull();
  });
});

describe("isJumpKey", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("takes Alt+J by its physical key, and by its character", () => {
    // macOS Option+J types "∆"; the key is still KeyJ.
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
    expect(isJumpKey(key({ altKey: true, code: "KeyK", key: "k" }))).toBe(
      false,
    );
  });
});
