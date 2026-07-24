import { describe, it, expect } from "vitest";

import {
  auditSnapshot,
  outlineSnapshot,
  tabSequenceSnapshot,
  assertNoUnlabeledInteractive,
  assertHeadingOrder,
  assertDialogsLabeled,
  assertLandmarkStructure,
  flow,
  A11yAssertionError,
} from "./index.js";

function mount(html: string): HTMLElement {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

/** Await a thenable expected to reject and return the Error it rejects with. */
async function captureError(p: PromiseLike<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected the flow to reject, but it resolved");
}

describe("auditSnapshot", () => {
  it("serializes a small tree deterministically", () => {
    const root = mount(`
      <main>
        <h1>Title</h1>
        <button>Go</button>
      </main>
    `);
    const out = auditSnapshot(root);
    expect(out).toContain(`main`);
    expect(out).toContain(`heading "Title" (level 1)`);
    expect(out).toContain(`button "Go"`);
  });

  it("redacts sensitive text when asked", () => {
    const root = mount(`<h1>Order #12345 placed</h1>`);
    const out = auditSnapshot(root, { redact: [/#\d+/g] });
    expect(out).not.toContain("#12345");
    expect(out).toContain("[REDACTED]");
  });
});

describe("outlineSnapshot", () => {
  it("indents by level", () => {
    const root = mount(`<h1>Top</h1><h2>A</h2><h3>A.1</h3><h2>B</h2>`);
    const lines = outlineSnapshot(root).split("\n");
    expect(lines[0]).toBe("h1 Top");
    expect(lines[1]).toBe("  h2 A");
    expect(lines[2]).toBe("    h3 A.1");
    expect(lines[3]).toBe("  h2 B");
  });
});

describe("tabSequenceSnapshot", () => {
  it("lists focusable nodes with positive tabindexes first", () => {
    const root = mount(`
      <button>Zero</button>
      <button tabindex="1">First</button>
    `);
    const out = tabSequenceSnapshot(root);
    // Positive tabindex ("First") sorts ahead of the DOM-order "Zero". Exact
    // match locks that order; lines carry no `NN.` sequence prefix.
    expect(out).toBe('button "First"\nbutton "Zero"');
  });
});

describe("assertions", () => {
  it("assertNoUnlabeledInteractive passes on labeled controls", () => {
    const root = mount(`<button>Go</button>`);
    expect(() => assertNoUnlabeledInteractive(root)).not.toThrow();
  });

  it("assertNoUnlabeledInteractive throws on unlabeled button", () => {
    const root = mount(`<button></button>`);
    expect(() => assertNoUnlabeledInteractive(root)).toThrow(
      A11yAssertionError,
    );
  });

  it("assertHeadingOrder flags missing h1", () => {
    const root = mount(`<h2>Only</h2>`);
    expect(() => assertHeadingOrder(root)).toThrow(/Missing <h1>/);
  });

  it("assertHeadingOrder flags skipped level", () => {
    const root = mount(`<h1>A</h1><h3>B</h3>`);
    expect(() => assertHeadingOrder(root)).toThrow(/level skipped/i);
  });

  it("assertDialogsLabeled passes on labeled dialog", () => {
    const root = mount(`
      <div role="dialog" aria-label="Confirm">Body</div>
    `);
    expect(() => assertDialogsLabeled(root)).not.toThrow();
  });

  it("assertDialogsLabeled throws on unlabeled dialog", () => {
    const root = mount(`<div role="dialog"></div>`);
    expect(() => assertDialogsLabeled(root)).toThrow(A11yAssertionError);
  });

  it("assertLandmarkStructure requires exactly one <main>", () => {
    const rootNone = mount(`<div>no main</div>`);
    expect(() => assertLandmarkStructure(rootNone)).toThrow(/Missing <main>/);

    const rootTwo = mount(`<main>A</main><main>B</main>`);
    expect(() => assertLandmarkStructure(rootTwo)).toThrow(
      /exactly one <main>/,
    );
  });
});

describe("flow", () => {
  it("finds a node by role and then runs an arbitrary expect block", async () => {
    const root = mount(`
      <main>
        <h1>Hi</h1>
        <button id="btn" aria-label="Go">Go</button>
      </main>
    `);
    await flow(root)
      .findByRole("button", { name: "Go" })
      .expect((tree) => {
        const node = Array.from(tree.nodes.values()).find(
          (n) => n.a11y.role === "button",
        );
        expect(node?.a11y.name).toBe("Go");
      });
  });

  it("throws with a helpful message when no node matches", async () => {
    const root = mount(`<p>Nothing here</p>`);
    await expect(
      flow(root).findByRole("button", { name: "Missing" }),
    ).rejects.toThrow(/no node with role "button"/);
  });

  it("a findByRole miss dumps the current tree so you can see what IS there", async () => {
    const root = mount(
      `<main><a href="/">Home</a><a href="/a">About</a></main>`,
    );
    const err = await captureError(
      flow(root).findByRole("button", { name: "Missing" }),
    );
    expect(err.message).toContain("Current tree:");
    // The dump is the real serialized tree, so the links that ARE present show
    // up — the whole point over a bare "not found".
    expect(err.message).toContain('link "Home"');
    expect(err.message).toContain('link "About"');
  });

  it("click() actually dispatches a click on the resolved element", async () => {
    const root = mount(`<main><button>Save</button></main>`);
    let clicks = 0;
    root.querySelector("button")!.addEventListener("click", () => {
      clicks += 1;
    });
    await flow(root).findByRole("button", { name: "Save" }).click();
    expect(clicks).toBe(1);
  });

  it("rejects when an action runs before findByRole", async () => {
    const root = mount(`<main><button>Save</button></main>`);
    await expect(flow(root).click()).rejects.toThrow(
      /call findByRole\(\) first/,
    );
  });

  it("type() writes into a textbox and fires input/change", async () => {
    const root = mount(`
      <main>
        <label>Name<input type="text" /></label>
      </main>
    `);
    const input = root.querySelector("input")!;
    let lastChange = "";
    input.addEventListener("change", () => {
      lastChange = input.value;
    });
    await flow(root).findByRole("textbox", { name: "Name" }).type("Ada");
    expect(input.value).toBe("Ada");
    expect(lastChange).toBe("Ada");
  });

  it("select(value) sets a native <select>'s value and fires change", async () => {
    const root = mount(`
      <main>
        <label>
          Country
          <select>
            <option value="">--</option>
            <option value="es">Spain</option>
            <option value="pt">Portugal</option>
          </select>
        </label>
      </main>
    `);
    const select = root.querySelector("select")!;
    let changed = false;
    select.addEventListener("change", () => {
      changed = true;
    });
    await flow(root).findByRole("combobox", { name: "Country" }).select("es");
    expect(select.value).toBe("es");
    expect(changed).toBe(true);
  });

  it("toggle() flips a <details> open/closed", async () => {
    const root = mount(`
      <main>
        <details><summary>More</summary><p>Body</p></details>
      </main>
    `);
    const details = root.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    await flow(root).findByRole("group", { name: "More" }).toggle();
    expect(details.open).toBe(true);
  });

  it("submit() requestSubmits the enclosing form", async () => {
    const root = mount(`
      <main>
        <form aria-label="Login"><button type="submit">Sign in</button></form>
      </main>
    `);
    let submitted = false;
    root.querySelector("form")!.addEventListener("submit", (e) => {
      submitted = true;
      e.preventDefault();
    });
    await flow(root).findByRole("button", { name: "Sign in" }).submit();
    expect(submitted).toBe(true);
  });

  it("propagates dispatch failures with a descriptive error", async () => {
    // <select> needs a string value; passing through the type-action codepath
    // on a select isn't supported, but we can force a failure by selecting
    // without a value via a forced cast.
    const root = mount(`
      <main>
        <label>Pick<select><option value="a">A</option></select></label>
      </main>
    `);
    // Dispatch path: select with no payload value → handleSelect returns
    // { success: false, error: "No value provided for select action" }.
    await expect(
      flow(root)
        .findByRole("combobox", { name: "Pick" })
        // Cast away the required arg to trigger the runtime failure path.
        .select(undefined as unknown as string),
    ).rejects.toThrow(/dispatch failed.*No value provided/);
  });

  describe("expectTree", () => {
    it("passes when the serialized tree matches", async () => {
      const root = mount(`<main><h1>Hi</h1><button>Go</button></main>`);
      // The wrapper <div> from mount() is generic and filtered out, so <main>
      // is the outermost printed node and starts at indent 0.
      await flow(root).expectTree(`main
  heading "Hi" (level 1)
  button "Go"`);
    });

    it("throws with a diff when the serialized tree differs", async () => {
      const root = mount(`<main><h1>Hi</h1></main>`);
      await expect(
        flow(root).expectTree(`main\n  heading "Bye"`),
      ).rejects.toThrow(/tree does not match expected snapshot/);
    });

    it("points at the first differing line instead of forcing an eyeball diff", async () => {
      const root = mount(`<main><h1>Hi</h1><button>Go</button></main>`);
      // Lines 1-2 match; the button label on line 3 is the first divergence.
      const err = await captureError(
        flow(root).expectTree(
          `main\n  heading "Hi" (level 1)\n  button "Nope"`,
        ),
      );
      expect(err.message).toContain("First difference at line 3:");
      expect(err.message).toMatch(/- .*button "Nope"/); // expected
      expect(err.message).toMatch(/\+ .*button "Go"/); // actual
      // The full blocks are still there for copy-paste snapshot updates.
      expect(err.message).toContain("--- expected");
      expect(err.message).toContain("--- actual");
    });
  });

  describe("expectActiveModal", () => {
    it("passes when an open dialog's name satisfies the predicate", async () => {
      const root = mount(`
        <main>
          <button id="open">Open</button>
        </main>
      `);
      const main = root.querySelector("main")!;
      root.querySelector("#open")!.addEventListener("click", () => {
        const dlg = document.createElement("div");
        dlg.setAttribute("role", "dialog");
        dlg.setAttribute("aria-label", "Confirm delete");
        dlg.textContent = "Are you sure?";
        main.appendChild(dlg);
      });
      await flow(root)
        .findByRole("button", { name: "Open" })
        .click()
        .expectActiveModal((name) => /confirm/i.test(name));
    });

    it("throws when an open dialog's name does NOT satisfy the predicate", async () => {
      const root = mount(`
        <main><div role="dialog" aria-label="Confirm">x</div></main>
      `);
      await expect(
        flow(root).expectActiveModal((name) => name === "Other"),
      ).rejects.toThrow(/did not satisfy predicate/);
    });

    it("passes with predicate=null when no dialog is open", async () => {
      const root = mount(`<main><h1>Hi</h1></main>`);
      await flow(root).expectActiveModal(null);
    });

    it("throws with predicate=null when a dialog IS open", async () => {
      const root = mount(`
        <main><div role="dialog" aria-label="Surprise">x</div></main>
      `);
      await expect(flow(root).expectActiveModal(null)).rejects.toThrow(
        /unexpected open dialog "Surprise"/,
      );
    });

    it("throws when a predicate is given but no dialog is open", async () => {
      const root = mount(`<main><h1>Hi</h1></main>`);
      await expect(flow(root).expectActiveModal(() => true)).rejects.toThrow(
        /no open dialog/,
      );
    });
  });

  it("respects a custom waitTimeout option", async () => {
    // No mutation fires, so each flow waits out its full timeout, then resolves.
    // Time a short-timeout flow against a default-timeout one: a comparison,
    // not an absolute bound, so the fixed jsdom/findByRole/dispatch overhead
    // cancels out instead of eating the budget — an absolute `< 150ms` bound
    // failed on Windows/slow envs (issue #162).
    const time = async (options: Parameters<typeof flow>[1]) => {
      const root = mount(`<main><button>Go</button></main>`);
      const start = Date.now();
      await flow(root, options).findByRole("button", { name: "Go" }).click();
      return Date.now() - start;
    };
    // Warm up first: the very first flow pays ~100ms one-time cold-start
    // (module init, first extraction) that only the leading run sees and would
    // otherwise shrink the measured gap. Both timed runs below are then warm.
    await time({ waitTimeout: 50 });
    const short = await time({ waitTimeout: 50 });
    const def = await time({}); // default 200ms
    // ~150ms apart in practice (200 − 50); a generous floor proves the option
    // is wired through rather than falling back to the default, independent of
    // absolute machine speed.
    expect(def - short).toBeGreaterThan(80);
  });

  it("resolves as soon as the action's own synchronous mutations settle", async () => {
    // `dispatch` is fully synchronous, so a handler's DOM writes land *during*
    // the dispatch call. When the observer was created afterwards it never saw
    // them, so the step could only ever end at the timeout — every action paid
    // the full `waitTimeout` as dead wait.
    //
    // Compare a mutating action against an inert one rather than asserting an
    // absolute bound — see the waitTimeout test above and issue #162.
    const time = async (withHandler: boolean) => {
      const root = mount(`<main><button>Go</button></main>`);
      if (withHandler) {
        root.querySelector("button")!.addEventListener("click", () => {
          root.appendChild(document.createElement("p"));
        });
      }
      const start = Date.now();
      await flow(root, { waitTimeout: 1000 })
        .findByRole("button", { name: "Go" })
        .click();
      return Date.now() - start;
    };

    await time(true); // warm up — the first flow pays a one-time cold start
    const mutating = await time(true);
    const inert = await time(false);

    // The mutating step settles one debounce (~50ms) after the click; the inert
    // one has nothing to observe and waits out the full 1000ms timeout. Half is
    // a generous margin that still fails loudly if the observer starts late.
    expect(mutating).toBeLessThan(inert / 2);
  });

  describe("a chain runs exactly once", () => {
    /** Mount a button that counts its own clicks. */
    const counter = () => {
      const root = mount(`<main><button>Go</button></main>`);
      const seen = { clicks: 0 };
      root
        .querySelector("button")!
        .addEventListener("click", () => seen.clicks++);
      return { root, seen };
    };

    it("does not re-dispatch actions when awaited twice", async () => {
      // `then()` used to call run() on every resolution, and run() replays the
      // whole steps array — so a second await re-clicked "Go". In real suites
      // that's a second Delete or a duplicate form submit.
      const { root, seen } = counter();
      const chain = flow(root, { waitTimeout: 50 })
        .findByRole("button", { name: "Go" })
        .click();

      await chain;
      await chain;

      expect(seen.clicks).toBe(1);
    });

    it("does not re-dispatch when resolved concurrently via Promise.all", async () => {
      const { root, seen } = counter();
      const chain = flow(root, { waitTimeout: 50 })
        .findByRole("button", { name: "Go" })
        .click();

      await Promise.all([chain, chain]);

      expect(seen.clicks).toBe(1);
    });

    it("rejects steps added after the chain has been awaited", async () => {
      // Silently ignoring the late step would drop whatever assertion it
      // carries — fail loudly instead.
      const { root } = counter();
      const chain = flow(root, { waitTimeout: 50 })
        .findByRole("button", { name: "Go" })
        .click();
      await chain;

      expect(() => chain.click()).toThrow(/after the chain has been awaited/);
    });
  });
});
