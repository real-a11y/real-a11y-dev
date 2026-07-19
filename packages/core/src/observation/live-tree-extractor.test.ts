import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  LiveTreeExtractor,
  DomObserver,
  extractA11yTree,
  resetIdCounter,
} from "../index.js";
import type { TreeChange } from "../types.js";

describe("LiveTreeExtractor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    resetIdCounter();
  });

  it("produces the same initial tree as extractA11yTree", () => {
    document.body.innerHTML = `
      <main>
        <button>Click me</button>
        <ul>
          <li>One</li>
          <li>Two</li>
        </ul>
      </main>
    `;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    const expected = extractA11yTree(document.body);
    expect(live.extract()).toEqual(expected);
  });

  it("updates a button name when its text node changes", async () => {
    document.body.innerHTML = `<main><button>Old</button></main>`;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    const button = document.querySelector("button")!;
    button.textContent = "New";

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);
    expect(result.nodes.get(result.rootId!)?.childIds).toHaveLength(1);
    const buttonId = result.nodes.get(result.rootId!)?.childIds[0];
    expect(result.nodes.get(buttonId!)?.a11y.name).toBe("New");

    observer.stop();
  });

  it("updates the tree when a list item is added", async () => {
    document.body.innerHTML = `<main><ul><li>One</li></ul></main>`;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    const ul = document.querySelector("ul")!;
    const li = document.createElement("li");
    li.textContent = "Two";
    ul.appendChild(li);

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);

    const ulId = result.nodes.get(result.rootId!)?.childIds[0];
    expect(result.nodes.get(ulId!)?.childIds).toHaveLength(2);

    observer.stop();
  });

  it("updates an aria-labelledby referrer when the target text changes", async () => {
    document.body.innerHTML = `
      <main>
        <span id="target">Old</span>
        <button aria-labelledby="target"></button>
      </main>
    `;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    document.getElementById("target")!.textContent = "New";

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);

    const buttonId = result.nodes.get(result.rootId!)?.childIds[1];
    expect(result.nodes.get(buttonId!)?.a11y.name).toBe("New");

    observer.stop();
  });

  it("updates a wrapping label's input name when the label text changes", async () => {
    document.body.innerHTML = `
      <main>
        <label>Old <input type="text" /></label>
      </main>
    `;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    const label = document.querySelector("label")!;
    label.childNodes[0]!.textContent = "New ";

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);

    // The label is suppressed; the input is promoted under the main region.
    const inputId = result.nodes.get(result.rootId!)?.childIds[0];
    expect(result.nodes.get(inputId!)?.a11y.name).toBe("New");

    observer.stop();
  });

  it("updates an input's value attribute after an input event", async () => {
    document.body.innerHTML = `<main><input type="text" /></main>`;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    const input = document.querySelector("input") as HTMLInputElement;
    input.value = "hello";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);

    const inputId = result.nodes.get(result.rootId!)?.childIds[0];
    expect(result.nodes.get(inputId!)?.dom.attributes.value).toBe("hello");

    observer.stop();
  });

  it("falls back to a full extract when a reference attribute changes", async () => {
    document.body.innerHTML = `
      <main>
        <span id="target">Old</span>
        <button aria-labelledby="target"></button>
      </main>
    `;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    const button = document.querySelector("button")!;
    button.setAttribute("aria-labelledby", "other");

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);
    const expected = extractA11yTree(document.body);

    expect(result.nodes).toEqual(expected.nodes);

    observer.stop();
  });

  it("stays correct through multiple incremental updates", async () => {
    document.body.innerHTML = `<main><button>One</button></main>`;

    const live = new LiveTreeExtractor(document.body, { mode: "a11y" });
    const changes: TreeChange[] = [];
    const observer = new DomObserver(
      document.body,
      (change) => {
        changes.push(change);
      },
      50,
    );
    observer.start();

    const button = document.querySelector("button")!;

    button.textContent = "Two";
    await vi.advanceTimersByTimeAsync(100);
    let result = live.refresh(changes[0]);
    expect(result.nodes).toEqual(extractA11yTree(document.body).nodes);

    button.setAttribute("aria-expanded", "true");
    await vi.advanceTimersByTimeAsync(100);
    result = live.refresh(changes[1]);
    expect(result.nodes).toEqual(extractA11yTree(document.body).nodes);

    observer.stop();
  });

  it("supports dom mode", async () => {
    document.body.innerHTML = `<main><div>Old</div></main>`;

    const live = new LiveTreeExtractor(document.body, { mode: "dom" });
    let lastChange: TreeChange | undefined;
    const observer = new DomObserver(
      document.body,
      (change) => {
        lastChange = change;
      },
      50,
    );
    observer.start();

    const div = document.querySelector("div")!;
    div.textContent = "New";

    await vi.advanceTimersByTimeAsync(100);

    const result = live.refresh(lastChange);

    const divId = result.nodes.get(result.rootId!)?.childIds[0];
    expect(result.nodes.get(divId!)?.dom.textContent).toBe("New");

    observer.stop();
  });
});
