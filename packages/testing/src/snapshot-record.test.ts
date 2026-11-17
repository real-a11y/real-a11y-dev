import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boxedTreeSnapshot } from "./matchers.js";
import { a11ySnapshotSerializer } from "./snapshot-box.js";
import {
  bindSnapshotRecorder,
  recordFolder,
  TREES_DIR_ENV,
  type SnapshotRecord,
} from "./snapshot-record.js";

import { a11yDiff, capture } from "./index.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "a11y-trees-"));
  process.env[TREES_DIR_ENV] = dir;
  bindSnapshotRecorder(expect);
});

afterEach(() => {
  delete process.env[TREES_DIR_ENV];
  rmSync(dir, { recursive: true, force: true });
  document.body.innerHTML = "";
});

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<main>${html}</main>`;
  return document.querySelector("main")!;
}

/** The files the recorder wrote, as written. */
function rawRecords(): string[] {
  const found: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(readFileSync(path, "utf8"));
    }
  };
  walk(dir);
  return found;
}

/** What the recorder wrote, in the order the test took them. */
function records(): SnapshotRecord[] {
  return rawRecords()
    .map((raw) => JSON.parse(raw) as SnapshotRecord)
    .sort((a, b) => a.index - b.index);
}

function roles(record: SnapshotRecord, side: "tree" | "before" | "after") {
  return record[side]!.nodes.map(([, node]) => node.a11y.role);
}

describe("snapshot recorder", () => {
  it("writes the tree behind a boxed tree snapshot", () => {
    const box = boxedTreeSnapshot(mount(`<h1>Hi</h1><button>Go</button>`));
    expect(a11ySnapshotSerializer.serialize(box)).toBe(box.text);

    const [record] = records();
    expect(record).toMatchObject({
      version: 1,
      kind: "tree",
      index: 1,
      text: box.text,
      test: "snapshot recorder > writes the tree behind a boxed tree snapshot",
      file: expect.stringMatching(/snapshot-record\.test\.ts$/),
    });
    expect(roles(record!, "tree")).toEqual(
      expect.arrayContaining(["heading", "button"]),
    );
  });

  it("writes both sides of a diff and where focus went", () => {
    const root = mount(`<button id="open">Open</button>`);
    root.querySelector<HTMLButtonElement>("#open")!.focus();
    const before = capture(root);
    root.insertAdjacentHTML(
      "beforeend",
      `<div role="alert" tabindex="-1" id="msg">Saved</div>`,
    );
    root.querySelector<HTMLElement>("#msg")!.focus();

    const box = a11yDiff(before, root);
    a11ySnapshotSerializer.serialize(box);

    const [record] = records();
    expect(record!.kind).toBe("diff");
    expect(roles(record!, "before")).not.toContain("alert");
    expect(roles(record!, "after")).toContain("alert");
    const after = new Map(record!.after!.nodes);
    expect(after.get(record!.focusBefore!)?.a11y.role).toBe("button");
    expect(after.get(record!.focusAfter!)?.a11y.role).toBe("alert");
  });

  it("redacts what the snapshot redacts, everywhere in the record", () => {
    const box = boxedTreeSnapshot(
      mount(`<button>Pay order 4821-7730</button>`),
      { redact: [/\d{4}-\d{4}/] },
    );
    a11ySnapshotSerializer.serialize(box);

    const [raw] = rawRecords();
    expect(raw).not.toContain("4821-7730");
    expect(raw).toContain("Pay order [REDACTED]");
  });

  it("redacts what a page supplied, never the ids the tree is built from", () => {
    const box = boxedTreeSnapshot(
      mount(
        `<button>Go 1</button><button>Go 2</button><a href="#3">Link 3</a>`,
      ),
      { redact: [/\d+/g] },
    );
    a11ySnapshotSerializer.serialize(box);

    const [record] = records();
    const ids = record!.tree!.nodes.map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(4);
    const names = record!.tree!.nodes.map(([, node]) => node.a11y.name);
    expect(names).toContain("Go [REDACTED]");
    expect(JSON.stringify(record)).not.toMatch(/Go \d|Link \d/);
  });

  it("redacts the page's element ids and the references to them alike", () => {
    const box = boxedTreeSnapshot(
      mount(
        `<button id="order-4821" aria-describedby="hint-4821">Pay</button><p id="hint-4821">Charged today</p>`,
      ),
      { redact: [/\d{4}/g] },
    );
    a11ySnapshotSerializer.serialize(box);

    const [raw] = rawRecords();
    expect(raw).not.toContain("4821");
    const button = records()[0]!.tree!.nodes.find(
      ([, node]) => node.a11y.role === "button",
    )![1];
    // The references go wherever the record keeps them: the raw check above.
    expect(button.dom?.attributes.id).toBe("order-[REDACTED]");
  });

  it("files two paths that slug alike in two folders", () => {
    expect(recordFolder("src/foo-bar.test.ts")).not.toBe(
      recordFolder("src/foo/bar.test.ts"),
    );
    expect(recordFolder("src\\foo\\bar.test.ts")).toBe(
      recordFolder("src/foo/bar.test.ts"),
    );
  });

  describe("field values", () => {
    it("keeps no editor's text, nor its ancestors' previews of it", () => {
      const root = mount(
        `<section><div role="textbox" contenteditable="true" aria-label="Note">EDITOR-SENTINEL</div></section>`,
      );
      const box = boxedTreeSnapshot(root);
      a11ySnapshotSerializer.serialize(box);

      const [raw] = rawRecords();
      expect(box.text).not.toContain("EDITOR-SENTINEL");
      expect(raw).not.toContain("EDITOR-SENTINEL");
    });

    it("keeps the own text of a node above a field", () => {
      const root = mount(
        `<p>Before <input aria-label="Email" value="jane@x.com"> after</p>`,
      );
      a11ySnapshotSerializer.serialize(boxedTreeSnapshot(root));

      const [record] = records();
      const paragraph = record!.tree!.nodes.find(
        ([, node]) => node.a11y.role === "paragraph",
      )![1];
      expect(paragraph.dom?.textContent).toContain("Before");
      expect(JSON.stringify(record)).not.toContain("jane@x.com");
    });

    const form = `
      <label>Email <input id="email" value="jane@x.com"></label>
      <label>Tip <input id="tip" type="range" min="0" max="20" value="15"></label>
      <div role="slider" aria-label="Volume" aria-valuenow="7" aria-valuetext="seven" tabindex="0"></div>`;

    it("keeps none that the text didn't print", () => {
      const root = mount(form);
      const box = boxedTreeSnapshot(root);
      a11ySnapshotSerializer.serialize(box);

      const [raw] = rawRecords();
      expect(box.text).not.toContain("jane@x.com");
      expect(raw).not.toContain("jane@x.com");
      expect(raw).not.toMatch(/"(value|aria-valuenow|aria-valuetext)":/);
      // What a row shows apart from its value stays.
      expect(raw).toContain('"name":"Email"');
    });

    it("keeps them when the snapshot printed them", () => {
      const box = boxedTreeSnapshot(mount(form), { values: true });
      a11ySnapshotSerializer.serialize(box);

      const [raw] = rawRecords();
      expect(box.text).toContain('"jane@x.com"');
      expect(raw).toContain('"value":"jane@x.com"');
    });

    it("keeps none on either side of a diff that didn't print them", () => {
      const root = mount(form);
      const before = capture(root);
      root.querySelector<HTMLInputElement>("#email")!.value = "ada@x.com";
      a11ySnapshotSerializer.serialize(a11yDiff(before, root));

      const [raw] = rawRecords();
      expect(raw).not.toContain("jane@x.com");
      expect(raw).not.toContain("ada@x.com");
    });

    it("masks a sensitive field even when values are printed", () => {
      const box = boxedTreeSnapshot(
        mount(
          `<label>Password <input type="password" value="hunter2"></label>`,
        ),
        { values: true },
      );
      a11ySnapshotSerializer.serialize(box);

      const [raw] = rawRecords();
      expect(raw).not.toContain("hunter2");
    });
  });

  it("numbers a test's snapshots in the order it takes them", () => {
    const root = mount(`<button>Go</button>`);
    expect(
      a11ySnapshotSerializer.serialize(boxedTreeSnapshot(root)),
    ).toBeTruthy();
    expect(
      a11ySnapshotSerializer.serialize(boxedTreeSnapshot(root)),
    ).toBeTruthy();

    expect(records().map((r) => r.index)).toEqual([1, 2]);
  });

  it("records the page as it was when the box was made", () => {
    const root = mount(`<button>Open</button>`);
    const box = boxedTreeSnapshot(root);
    root.insertAdjacentHTML("beforeend", `<div role="dialog">Later</div>`);
    a11ySnapshotSerializer.serialize(box);

    const [record] = records();
    expect(box.text).not.toContain("dialog");
    expect(roles(record!, "tree")).not.toContain("dialog");
  });

  it("records a box once, however often it is printed", () => {
    const box = boxedTreeSnapshot(mount(`<button>Go</button>`));
    a11ySnapshotSerializer.serialize(box);
    a11ySnapshotSerializer.serialize(box);

    expect(records()).toHaveLength(1);
  });

  it("records nothing while the directory isn't set", () => {
    delete process.env[TREES_DIR_ENV];
    a11ySnapshotSerializer.serialize(
      boxedTreeSnapshot(mount(`<button>Go</button>`)),
    );

    expect(records()).toHaveLength(0);
  });
});
