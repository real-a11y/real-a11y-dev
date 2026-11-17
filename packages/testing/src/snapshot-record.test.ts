import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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
function rawRecords(under = dir): string[] {
  const found: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(readFileSync(path, "utf8"));
    }
  };
  walk(under);
  return found;
}

/** What the recorder wrote, in the order the test took them. */
function records(under = dir): SnapshotRecord[] {
  return rawRecords(under)
    .map((raw) => JSON.parse(raw) as SnapshotRecord)
    .sort((a, b) => a.sequence - b.sequence);
}

function nodeOf(record: SnapshotRecord, role: string) {
  return record.tree!.nodes.find(([, node]) => node.a11y.role === role)![1];
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
      version: 2,
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

  it("redacts no attribute or property the viewer reads as structure", () => {
    const box = boxedTreeSnapshot(
      mount(
        `<h2>Title 2</h2><div role="dialog" tabindex="-1" aria-label="Step 1">x</div><a href="#a" tabindex="3">Link 4</a>`,
      ),
      { redact: [/\d+/g] },
    );
    a11ySnapshotSerializer.serialize(box);

    const [record] = records();
    expect(box.text).toContain("(level 2)");
    expect(nodeOf(record!, "heading").a11y.properties.level).toBe("2");
    expect(nodeOf(record!, "heading").a11y.name).toBe("Title [REDACTED]");
    expect(nodeOf(record!, "dialog").dom?.attributes.tabindex).toBe("-1");
    expect(nodeOf(record!, "link").dom?.attributes.tabindex).toBe("3");
  });

  it("files one test file's records apart per Vitest project", () => {
    const file = "src/p.test.ts";
    const folders = new Set([
      recordFolder(file),
      recordFolder(file, "jsdom"),
      recordFolder(file, "happy-dom"),
    ]);
    expect(folders.size).toBe(3);
  });

  it("orders and dates records by the real clock, not a faked one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    try {
      const root = mount(`<button>Go</button>`);
      a11ySnapshotSerializer.serialize(boxedTreeSnapshot(root));
      a11ySnapshotSerializer.serialize(boxedTreeSnapshot(root));
    } finally {
      vi.useRealTimers();
    }

    const [first, second] = records();
    expect(first!.recordedAt.startsWith("2020")).toBe(false);
    expect(second!.sequence).toBe(first!.sequence + 1);
  });

  it("throws on a root that is neither an element nor a tree, as without it", () => {
    expect(() => boxedTreeSnapshot(document as never)).toThrow(
      /expected a DOM Element or an extracted a11y tree/,
    );
    expect(() => boxedTreeSnapshot(null as never)).toThrow(
      /expected a DOM Element or an extracted a11y tree/,
    );
    expect(rawRecords()).toHaveLength(0);
  });

  it("records nothing when it can't tell which test is running", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    bindSnapshotRecorder({ getState: () => ({}) });
    a11ySnapshotSerializer.serialize(
      boxedTreeSnapshot(mount(`<button>Go</button>`)),
    );

    expect(rawRecords()).toHaveLength(0);
    warn.mockRestore();
  });

  it("keeps no panel state in a record", () => {
    a11ySnapshotSerializer.serialize(
      boxedTreeSnapshot(mount(`<button>Go</button>`)),
    );

    const [record] = records();
    expect(record!.tree!.nodes.every(([, node]) => !("ui" in node))).toBe(true);
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
    it("keeps nothing typed into an editor's lines and runs", () => {
      const root = mount(
        `<div role="textbox" contenteditable="true" aria-label="Note">FIRST-LINE<div>SECOND-LINE</div><b>BOLD-RUN</b></div>`,
      );
      const box = boxedTreeSnapshot(root);
      a11ySnapshotSerializer.serialize(box);

      const [record] = records();
      const raw = JSON.stringify(record);
      expect(box.text).toContain('textbox "Note"');
      for (const typed of ["FIRST-LINE", "SECOND-LINE", "BOLD-RUN"]) {
        expect(raw).not.toContain(typed);
      }
      expect(nodeOf(record!, "textbox").childIds).toEqual([]);
      const ids = new Set(record!.tree!.nodes.map(([id]) => id));
      expect(
        record!.tree!.nodes.every(
          ([, node]) => node.parentId === null || ids.has(node.parentId),
        ),
      ).toBe(true);
    });

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

    it("keeps none even where the text printed them", () => {
      const box = boxedTreeSnapshot(mount(form), { values: true });
      a11ySnapshotSerializer.serialize(box);

      // The text holds what it printed; the tree beside it holds none.
      const [record] = records();
      const tree = JSON.stringify(record!.tree);
      expect(record!.text).toContain('"jane@x.com"');
      expect(tree).not.toContain("jane@x.com");
      expect(tree).not.toMatch(/"(value|aria-valuenow|aria-valuetext)":/);
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

describe("a retried test", () => {
  // Hooks run again for each try, and the outer ones make a fresh directory:
  // this one outlives the tries, as a real run's records directory does.
  const shared = mkdtempSync(join(tmpdir(), "a11y-retry-"));
  afterAll(() => rmSync(shared, { recursive: true, force: true }));
  let tries = 0;

  it("keeps only the records of the try that counted", { retry: 1 }, () => {
    process.env[TREES_DIR_ENV] = shared;
    tries++;
    const root = mount(`<button>Try ${tries}</button>`);
    a11ySnapshotSerializer.serialize(boxedTreeSnapshot(root));
    if (tries === 1) {
      a11ySnapshotSerializer.serialize(boxedTreeSnapshot(root));
      throw new Error("the first try fails, after two snapshots");
    }

    const kept = records(shared);
    expect(kept.map((r) => r.index)).toEqual([1]);
    expect(kept[0]!.text).toContain("Try 2");
  });
});

describe.concurrent("concurrent tests", () => {
  it("record nothing: the runner can't place their snapshots", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    a11ySnapshotSerializer.serialize(
      boxedTreeSnapshot(mount(`<button>Go</button>`)),
    );

    expect(rawRecords()).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/concurrent/));
    warn.mockRestore();
  });
});
