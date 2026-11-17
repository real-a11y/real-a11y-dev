// No `registerA11yMatchers` in this file, on purpose: these are the snapshots
// a project gets before it sets the serializer up.
import { describe, expect, it } from "vitest";

import { boxSnapshot } from "./snapshot-box.js";

import { a11yDiff, capture } from "./index.js";

function invalidPhoneDiff() {
  document.body.innerHTML = `<main><label for="p">Phone</label><input id="p"></main>`;
  const main = document.querySelector("main")!;
  const before = capture(main);
  document.getElementById("p")!.setAttribute("aria-invalid", "true");
  return a11yDiff(before, main);
}

describe("a snapshot box without the serializer registered", () => {
  it("snapshots as its text, not as the box object", () => {
    expect(invalidPhoneDiff()).toMatchInlineSnapshot(
      `"~ textbox "Phone": a11y.states.invalid (unset) → true"`,
    );
  });

  it("serializes to its text as JSON", () => {
    expect(JSON.stringify(boxSnapshot("main"))).toBe('"main"');
  });

  it("keeps the same keys and equality as before", () => {
    const box = boxSnapshot("main");
    expect(Object.keys(box)).toEqual(["@real-a11y-dev/a11y-snapshot", "text"]);
    expect(box).toEqual(boxSnapshot("main"));
    expect(box).not.toEqual(boxSnapshot("banner"));
  });
});
