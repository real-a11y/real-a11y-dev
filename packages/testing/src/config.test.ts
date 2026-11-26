import { afterEach, describe, expect, it } from "vitest";

import { registerA11yMatchers } from "./matchers.js";
import { snapshotTreesOf } from "./snapshot-box.js";

import { a11yDiff, capture, configureA11y, flow } from "./index.js";

function mount(html: string): HTMLElement {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

/** Two lists each gain an item at 12:30; returns the root and the capture before. */
function addTwoItems() {
  const root = mount(`
    <main>
      <ul aria-label="Todo"><li>a</li></ul>
      <ul aria-label="Done"><li>b</li></ul>
    </main>`);
  const before = capture(root);
  const [todo, done] = root.querySelectorAll("ul");
  todo!.insertAdjacentHTML("beforeend", "<li>Ship at 12:30</li>");
  done!.insertAdjacentHTML("beforeend", "<li>Test</li>");
  return { root, before };
}

const ADDED = '+ listitem "Ship at 12:30"\n+ listitem "Test"';
const ADDED_REDACTED = '+ listitem "Ship at [REDACTED]"\n+ listitem "Test"';
const COUNTS =
  '\n~ list "Todo": childIds 1 child → 2 children' +
  '\n~ list "Done": childIds 1 child → 2 children';
const TIME = /\d{2}:\d{2}/;

afterEach(() => {
  configureA11y({ diff: {} });
  document.body.innerHTML = "";
});

describe("configureA11y({ diff })", () => {
  it("sets the options a11yDiff prints with when a call passes none", () => {
    const { root, before } = addTwoItems();
    expect(a11yDiff(before, root).text).toBe(ADDED + COUNTS);

    configureA11y({ diff: { childIds: false } });
    expect(a11yDiff(before, root).text).toBe(ADDED);
  });

  it("lets a call's own options win, key by key", () => {
    const { root, before } = addTwoItems();
    configureA11y({ diff: { childIds: false, redact: [TIME] } });

    expect(a11yDiff(before, root).text).toBe(ADDED_REDACTED);
    // `childIds: true` is this call's; the project's `redact` still applies.
    expect(a11yDiff(before, root, { childIds: true }).text).toBe(
      ADDED_REDACTED + COUNTS,
    );
  });

  it("treats an undefined key in a call as not given", () => {
    const { root, before } = addTwoItems();
    configureA11y({ diff: { childIds: false } });
    expect(a11yDiff(before, root, { childIds: undefined }).text).toBe(ADDED);
  });

  it("replaces the project's redact list with a call's, and [] turns it off", () => {
    const { root, before } = addTwoItems();
    configureA11y({ diff: { childIds: false, redact: [TIME] } });

    expect(a11yDiff(before, root, { redact: [/Test/] }).text).toBe(
      '+ listitem "Ship at 12:30"\n+ listitem "[REDACTED]"',
    );
    expect(a11yDiff(before, root, { redact: [] }).text).toBe(ADDED);
  });

  it("records the redact the text printed with, for the snapshot report", () => {
    const { root, before } = addTwoItems();
    configureA11y({ diff: { redact: [TIME] } });

    const trees = snapshotTreesOf(a11yDiff(before, root))!();
    expect(trees.redact).toEqual([TIME]);
    const own = snapshotTreesOf(a11yDiff(before, root, { redact: [] }))!();
    expect(own.redact).toEqual([]);
  });

  it("applies values as a default too", () => {
    const root = mount(
      `<main><label for="q">Search</label><input id="q"></main>`,
    );
    const before = capture(root);
    root.querySelector<HTMLInputElement>("#q")!.value = "hello";
    expect(a11yDiff(before, root).text).toBe("(no changes)");

    configureA11y({ diff: { values: true } });
    expect(a11yDiff(before, root).text).toBe(
      '~ textbox "Search": a11y.value (unset) → "hello"',
    );
    expect(a11yDiff(before, root, { values: false }).text).toBe("(no changes)");
  });

  it("replaces the diff defaults on each call, and { diff: {} } clears them", () => {
    const { root, before } = addTwoItems();
    configureA11y({ diff: { childIds: false } });
    configureA11y({ diff: { redact: [TIME] } });
    // The second call replaced the first: childIds is back to its default.
    expect(a11yDiff(before, root).text).toBe(ADDED_REDACTED + COUNTS);

    configureA11y({ diff: {} });
    expect(a11yDiff(before, root).text).toBe(ADDED + COUNTS);
  });

  it("keeps the diff defaults when a call names no diff section", () => {
    const { root, before } = addTwoItems();
    configureA11y({ diff: { childIds: false } });
    configureA11y({});
    expect(a11yDiff(before, root).text).toBe(ADDED);
  });

  it("copies the redact list, so changing the caller's array later moves nothing", () => {
    const { root, before } = addTwoItems();
    const patterns: RegExp[] = [];
    configureA11y({ diff: { childIds: false, redact: patterns } });
    patterns.push(TIME);
    expect(a11yDiff(before, root).text).toBe(ADDED);
  });
});

describe("registerA11yMatchers(expect, config)", () => {
  it("sets the same defaults as configureA11y", () => {
    const { root, before } = addTwoItems();
    registerA11yMatchers(expect, { diff: { childIds: false } });
    expect(a11yDiff(before, root).text).toBe(ADDED);
  });

  it("leaves the defaults alone without a config", () => {
    const { root, before } = addTwoItems();
    configureA11y({ diff: { childIds: false } });
    registerA11yMatchers(expect);
    expect(a11yDiff(before, root).text).toBe(ADDED);
  });
});

describe("flow().expectChanges with project defaults", () => {
  function withAdd() {
    const root = mount(
      `<main><button id="act">Add</button><ul role="listbox" id="lb"></ul></main>`,
    );
    root.querySelector("#act")!.addEventListener("click", () => {
      root
        .querySelector("#lb")!
        .insertAdjacentHTML("beforeend", '<li role="option">Spain</li>');
    });
    return root;
  }

  it("compares a string against the diff printed with them", async () => {
    configureA11y({ diff: { childIds: false } });
    await flow(withAdd())
      .findByRole("button", { name: "Add" })
      .click()
      .expectChanges('+ option "Spain"');
  });

  it("prints a ChangeSpec failure's diff with them", async () => {
    configureA11y({ diff: { redact: [/Spain/] } });
    const run = flow(withAdd())
      .findByRole("button", { name: "Add" })
      .click()
      .expectChanges({ added: [{ role: "option", name: "France" }] });
    await expect(run).rejects.toThrow('+ option "[REDACTED]"');
  });
});
