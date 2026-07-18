import { extract } from "@real-a11y-dev/serialize";
import { describe, it, expect, afterEach } from "vitest";

import { a11ySnapshotSerializer } from "./snapshot-box.js";

import { a11yDiff, capture, flow } from "./index.js";

function mount(html: string): HTMLElement {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("capture", () => {
  it("captures the tree and the focused node", () => {
    const root = mount(`<main><button id="b">Go</button></main>`);
    root.querySelector<HTMLButtonElement>("#b")!.focus();
    const cap = capture(root);
    expect(cap.tree.nodes.size).toBeGreaterThan(0);
    expect(cap.focus?.a11y.role).toBe("button");
  });

  it("focus is null when nothing inside the root is focused", () => {
    const root = mount(`<main><button>Go</button></main>`);
    expect(capture(root).focus).toBeNull();
  });
});

describe("a11yDiff", () => {
  it("boxes the change list; after may be a live Element (captured now)", () => {
    const root = mount(`<ul role="list"></ul>`);
    const before = capture(root);
    root
      .querySelector("ul")!
      .insertAdjacentHTML("beforeend", '<li role="option">Spain</li>');
    const box = a11yDiff(before, root);
    expect(box.text).toContain('+ option "Spain"');
    expect(box.text).toContain("childIds 0 children → 1 child");
  });

  it("(no changes) when the tree is untouched", () => {
    const root = mount(`<main><button>Go</button></main>`);
    const before = capture(root);
    expect(a11yDiff(before, root).text).toBe("(no changes)");
  });

  it("renders a focus transition when BOTH sides are captures", () => {
    const root = mount(
      `<main><button id="a">A</button><button id="b">B</button></main>`,
    );
    root.querySelector<HTMLButtonElement>("#a")!.focus();
    const before = capture(root);
    root.querySelector<HTMLButtonElement>("#b")!.focus();
    const after = capture(root);
    expect(a11yDiff(before, after).text).toContain(
      'focus: button "A" → button "B"',
    );
  });

  it("omits the focus line when a side is a plain ExtractionResult", () => {
    const root = mount(`<main><button id="a">A</button></main>`);
    // `before` is a bare tree — no focus context — so even though `after`
    // captures focus on the button, no focus line is rendered.
    const beforeTree = extract(root, "a11y");
    root.querySelector<HTMLButtonElement>("#a")!.focus();
    const after = capture(root);
    expect(a11yDiff(beforeTree, after).text).not.toContain("focus:");
  });

  it("produces a box the a11y snapshot serializer renders", () => {
    const root = mount(`<ul role="list"></ul>`);
    const before = capture(root);
    root
      .querySelector("ul")!
      .insertAdjacentHTML("beforeend", '<li role="option">X</li>');
    const box = a11yDiff(before, root);
    expect(a11ySnapshotSerializer.test(box)).toBe(true);
    expect(a11ySnapshotSerializer.serialize(box)).toBe(box.text);
  });

  it("honors redact", () => {
    const root = mount(`<ul role="list"></ul>`);
    const before = capture(root);
    root
      .querySelector("ul")!
      .insertAdjacentHTML(
        "beforeend",
        '<li role="option">john@example.com</li>',
      );
    const box = a11yDiff(before, root, { redact: [/\S+@\S+/] });
    expect(box.text).toContain("[REDACTED]");
    expect(box.text).not.toContain("@example.com");
  });
});

describe("flow().expectChanges", () => {
  /** A button whose click mutates the DOM via `handler`. */
  function withClick(html: string, handler: (root: HTMLElement) => void) {
    const root = mount(html);
    root.querySelector("#act")!.addEventListener("click", () => handler(root));
    return root;
  }

  it("ChangeSpec: subset-matches what the interaction added and changed", async () => {
    const root = withClick(
      `<main><button id="act">Open</button><ul role="list" id="lb"></ul></main>`,
      (r) =>
        r
          .querySelector("#lb")!
          .insertAdjacentHTML(
            "beforeend",
            '<li role="option">Spain</li><li role="option">France</li>',
          ),
    );
    await flow(root)
      .findByRole("button", { name: "Open" })
      .click()
      .expectChanges({
        added: [
          { role: "option", name: "Spain" },
          { role: "option", name: "France" },
        ],
      });
  });

  it("string form is the trim-compared serializeTreeDiff output", async () => {
    const root = withClick(
      `<main><button id="act">Add</button><ul role="list" id="lb"></ul></main>`,
      (r) =>
        r
          .querySelector("#lb")!
          .insertAdjacentHTML("beforeend", '<li role="option">Spain</li>'),
    );
    await flow(root)
      .findByRole("button", { name: "Add" })
      .click()
      .expectChanges(
        ['+ option "Spain"', "~ list: childIds 0 children → 1 child"].join(
          "\n",
        ),
      );
  });

  it("predicate form receives the TreeDiff", async () => {
    const root = withClick(
      `<main><button id="act">Add</button><ul role="list" id="lb"></ul></main>`,
      (r) =>
        r
          .querySelector("#lb")!
          .insertAdjacentHTML("beforeend", '<li role="option">Spain</li>'),
    );
    let seen = -1;
    await flow(root)
      .findByRole("button", { name: "Add" })
      .click()
      .expectChanges((diff) => {
        seen = diff.added.length;
      });
    expect(seen).toBe(1);
  });

  it("exact:true fails on an unexpected extra, with the diff in the message", async () => {
    const root = withClick(
      `<main><button id="act">Open</button><ul role="list" id="lb"></ul></main>`,
      (r) =>
        r
          .querySelector("#lb")!
          .insertAdjacentHTML(
            "beforeend",
            '<li role="option">Spain</li><li role="option">France</li>',
          ),
    );
    await expect(
      flow(root)
        .findByRole("button", { name: "Open" })
        .click()
        .expectChanges({
          added: [{ role: "option", name: "Spain" }],
          exact: true,
        }),
    ).rejects.toThrow(/unexpected ADDED option "France"/);
  });

  it("throws when no action has run yet", async () => {
    const root = mount(`<main><button>Go</button></main>`);
    await expect(
      flow(root).findByRole("button", { name: "Go" }).expectChanges({}),
    ).rejects.toThrow(/no action has run/);
  });

  it("resets the window — a second expectChanges covers only the next action", async () => {
    const root = mount(
      `<main><button id="one">One</button><button id="two">Two</button><ul role="list" id="lb"></ul></main>`,
    );
    root
      .querySelector("#one")!
      .addEventListener("click", () =>
        root
          .querySelector("#lb")!
          .insertAdjacentHTML("beforeend", '<li role="option">A</li>'),
      );
    root
      .querySelector("#two")!
      .addEventListener("click", () =>
        root
          .querySelector("#lb")!
          .insertAdjacentHTML("beforeend", '<li role="option">B</li>'),
      );
    await flow(root)
      .findByRole("button", { name: "One" })
      .click()
      .expectChanges({ added: [{ role: "option", name: "A" }], exact: true })
      // The second window sees ONLY B — if the baseline hadn't reset, A would
      // still be here and exact:true would fail.
      .findByRole("button", { name: "Two" })
      .click()
      .expectChanges({ added: [{ role: "option", name: "B" }], exact: true });
  });
});
