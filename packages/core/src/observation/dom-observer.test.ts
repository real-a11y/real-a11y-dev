import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { isModal } from "../extraction/dom-extractor.js";
import { clobber, shadow } from "../test-support/clobber.js";
import type { TreeChange } from "../types.js";

import { DomObserver } from "./dom-observer.js";

/**
 * jsdom delivers MutationObserver callbacks asynchronously (microtask).
 * Helper that flushes a microtask + advances the debounce timer.
 */
async function settleObserver(debounceMs = 300) {
  await Promise.resolve(); // let MutationObserver flush its queued records
  vi.advanceTimersByTime(debounceMs + 10);
}

describe("DomObserver", () => {
  let onTreeChange: ReturnType<typeof vi.fn>;
  let observer: DomObserver;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    onTreeChange = vi.fn();
  });

  afterEach(() => {
    observer?.stop();
    vi.useRealTimers();
    document.body.innerHTML = "";
    document.documentElement
      .querySelectorAll("#__sn-highlight, #__sn-curtain")
      .forEach((el) => el.remove());
  });

  it("fires the callback after a real DOM mutation", async () => {
    observer = new DomObserver(document.body, onTreeChange, 100);
    observer.start();

    const btn = document.createElement("button");
    btn.textContent = "click me";
    document.body.appendChild(btn);

    await settleObserver(100);

    expect(onTreeChange).toHaveBeenCalledTimes(1);
  });

  it("observes label[for] re-targeting", async () => {
    document.body.innerHTML = `
      <label id="lbl" for="one">Name</label>
      <input id="one" /><input id="two" />
    `;
    observer = new DomObserver(document.body, onTreeChange, 100);
    observer.start();

    // Re-pointing a label changes the accessible name of both the old and the
    // new control. LiveTreeExtractor treats `for` as a reference attribute and
    // falls back to a full extraction — which only happens if it is observed.
    document.getElementById("lbl")!.setAttribute("for", "two");

    await settleObserver(100);

    expect(onTreeChange).toHaveBeenCalledTimes(1);
    const change = onTreeChange.mock.calls[0]![0];
    expect(
      change.mutations?.some((m: MutationRecord) => m.attributeName === "for"),
    ).toBe(true);
  });

  it.each(["size", "multiple"])(
    "observes a select's %s, which decides its shape",
    async (attr) => {
      document.body.innerHTML = `<select id="s" aria-label="Size"><option>S</option></select>`;
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      // A drop-down has an expanded state and a list box has none, and the
      // two attributes decide which a select is.
      document.getElementById("s")!.setAttribute(attr, "3");

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
      const change = onTreeChange.mock.calls[0]![0];
      expect(
        change.mutations?.some((m: MutationRecord) => m.attributeName === attr),
      ).toBe(true);
    },
  );

  it("debounces rapid mutations into a single callback", async () => {
    observer = new DomObserver(document.body, onTreeChange, 100);
    observer.start();

    for (let i = 0; i < 5; i++) {
      const div = document.createElement("div");
      document.body.appendChild(div);
    }

    await settleObserver(100);

    expect(onTreeChange).toHaveBeenCalledTimes(1);
  });

  // ── Max-wait ceiling ────────────────────────────────────────────────────────
  // A trailing-only debounce is starved forever by a stream that mutates more
  // often than the debounce interval (streaming AI responses, progress bars,
  // animated style updates). The ceiling forces a flush every maxWaitMs. These
  // drive `input` events because that path calls scheduleChange synchronously,
  // giving exact control over the fake clock.
  describe("max-wait ceiling", () => {
    function streamInputs(el: HTMLElement, everyMs: number, forMs: number) {
      for (let t = 0; t < forMs; t += everyMs) {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        vi.advanceTimersByTime(everyMs);
      }
    }

    it("flushes a continuous stream at the ceiling instead of starving forever", () => {
      const input = document.createElement("input");
      document.body.appendChild(input);
      // debounce 100, ceiling 500; events every 50ms never leave a 100ms gap.
      observer = new DomObserver(
        document.body,
        onTreeChange,
        100,
        undefined,
        500,
      );
      observer.start();

      streamInputs(input, 50, 500);

      // A trailing-only debounce would be at 0 calls here; the ceiling fired.
      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("keeps flushing periodically while the stream continues", () => {
      const input = document.createElement("input");
      document.body.appendChild(input);
      observer = new DomObserver(
        document.body,
        onTreeChange,
        100,
        undefined,
        500,
      );
      observer.start();

      // ~1200ms of sustained 50ms-spaced events → at least two ceiling flushes.
      streamInputs(input, 50, 1200);

      expect(onTreeChange.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("a single change still fires at the debounce interval, not the ceiling", () => {
      const input = document.createElement("input");
      document.body.appendChild(input);
      observer = new DomObserver(
        document.body,
        onTreeChange,
        100,
        undefined,
        1000,
      );
      observer.start();

      input.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(110);

      // Fired at the 100ms debounce, not deferred to the 1000ms ceiling.
      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("stop() cancels a pending ceiling flush", () => {
      const input = document.createElement("input");
      document.body.appendChild(input);
      observer = new DomObserver(
        document.body,
        onTreeChange,
        100,
        undefined,
        500,
      );
      observer.start();

      input.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(50);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      observer.stop();
      vi.advanceTimersByTime(1000);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    it("clamps the ceiling to at least one debounce interval", () => {
      const input = document.createElement("input");
      document.body.appendChild(input);
      // ceiling (50) < debounce (200): clamp raises it to 200, so a single
      // change fires at the debounce, not at an unclamped 50ms.
      observer = new DomObserver(
        document.body,
        onTreeChange,
        200,
        undefined,
        50,
      );
      observer.start();

      input.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(60);
      expect(onTreeChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(160); // total 220 > 200
      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });
  });

  // ── Internal-sentinel filtering ────────────────────────────────────────────
  // These tests cover the bug fix where drawing the focus-highlight overlay
  // (or the screen curtain) on the host page would itself be a DOM mutation
  // observed by DomObserver, causing a feedback loop of re-extractions.

  describe("ignores mutations from internal sentinel elements", () => {
    it("skips when only the highlight overlay is added", async () => {
      observer = new DomObserver(document.documentElement, onTreeChange, 100);
      observer.start();

      const overlay = document.createElement("div");
      overlay.id = "__sn-highlight";
      document.documentElement.appendChild(overlay);

      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    it("skips when the highlight overlay is removed", async () => {
      // Pre-existing overlay (would have been added before observer started)
      const overlay = document.createElement("div");
      overlay.id = "__sn-highlight";
      document.documentElement.appendChild(overlay);

      observer = new DomObserver(document.documentElement, onTreeChange, 100);
      observer.start();

      overlay.remove();
      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    it("skips when the overlay's position/style changes", async () => {
      const overlay = document.createElement("div");
      overlay.id = "__sn-highlight";
      document.documentElement.appendChild(overlay);

      observer = new DomObserver(document.documentElement, onTreeChange, 100);
      observer.start();

      // Simulate the FocusManager moving the highlight to a new element.
      overlay.style.top = "42px";
      overlay.style.left = "100px";
      overlay.style.width = "200px";
      overlay.style.height = "30px";

      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    it("skips when only the screen curtain is added", async () => {
      observer = new DomObserver(document.documentElement, onTreeChange, 100);
      observer.start();

      const curtain = document.createElement("div");
      curtain.id = "__sn-curtain";
      curtain.innerHTML = "<div>Screen Curtain</div>";
      document.documentElement.appendChild(curtain);

      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    it("skips when only the curtain is removed", async () => {
      const curtain = document.createElement("div");
      curtain.id = "__sn-curtain";
      document.documentElement.appendChild(curtain);

      observer = new DomObserver(document.documentElement, onTreeChange, 100);
      observer.start();

      curtain.remove();
      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    it("STILL fires on a real mutation that arrives in the same batch as an overlay change", async () => {
      // Critical: we can't drop a whole batch just because *some* of it was
      // ours — a real user mutation in the same microtask must still be
      // delivered. This is the "mixed batch" guarantee.
      observer = new DomObserver(document.documentElement, onTreeChange, 100);
      observer.start();

      const overlay = document.createElement("div");
      overlay.id = "__sn-highlight";
      document.documentElement.appendChild(overlay);

      const btn = document.createElement("button");
      btn.textContent = "real user mutation";
      document.body.appendChild(btn);

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("does not skip mutations on unrelated elements that happen to be empty", async () => {
      // Regression guard: an empty addedNodes/removedNodes record should
      // not be misclassified as internal.
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      // Cause a `characterData` mutation on a normal text node — the
      // total of addedNodes + removedNodes is 0, but the mutation type is
      // "characterData", not "childList". Our impl handles each type.
      const p = document.createElement("p");
      const txt = document.createTextNode("before");
      p.appendChild(txt);
      document.body.appendChild(p);
      await settleObserver(100);
      onTreeChange.mockClear();

      txt.data = "after";
      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    // The sentinel subtree is ours in its entirety, not just its root. The
    // characterData branch has always climbed to find that out; these two pin
    // the same for `attributes` and `childList`, so that mutating anything
    // *inside* a mounted overlay cannot re-arm the re-extract loop.
    it("skips an attribute change on an element inside the curtain subtree", async () => {
      const curtain = document.createElement("div");
      curtain.id = "__sn-curtain";
      const label = document.createElement("div");
      label.textContent = "Screen Curtain";
      curtain.appendChild(label);
      document.documentElement.appendChild(curtain);

      observer = new DomObserver(document.documentElement, onTreeChange, 100);
      observer.start();

      // A descendant of the sentinel, not the sentinel itself.
      label.className = "sn-curtain__label--visible";

      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    it("skips a child added inside the highlight overlay subtree", async () => {
      const overlay = document.createElement("div");
      overlay.id = "__sn-highlight";
      const frame = document.createElement("div");
      overlay.appendChild(frame);
      document.documentElement.appendChild(overlay);

      observer = new DomObserver(document.documentElement, onTreeChange, 100);
      observer.start();

      // The added node carries no sentinel id of its own — it is internal
      // only by virtue of where it lands.
      frame.appendChild(document.createElement("span"));

      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    it("skips mutations on a caller-supplied custom sentinel id", async () => {
      observer = new DomObserver(
        document.documentElement,
        onTreeChange,
        100,
        new Set(["__custom-overlay"]),
      );
      observer.start();

      const overlay = document.createElement("div");
      overlay.id = "__custom-overlay";
      document.documentElement.appendChild(overlay);

      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    it("custom internalIds still filters the built-in sentinel ids", async () => {
      // Passing a custom set must ADD to the built-ins, not replace them.
      // If it replaced them, the highlight overlay would be observed as a
      // user mutation and re-arm the re-extract → re-render → re-highlight
      // feedback loop the sentinel filter exists to prevent.
      observer = new DomObserver(
        document.documentElement,
        onTreeChange,
        100,
        new Set(["__custom-overlay"]),
      );
      observer.start();

      const overlay = document.createElement("div");
      overlay.id = "__sn-highlight";
      document.documentElement.appendChild(overlay);

      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    // The sentinel check climbs from a changed text node to the document.
    // `<form>` and the document both have [LegacyOverrideBuiltIns], so in a
    // real browser a control or a named `<img>` called `parentNode` shadows
    // their `parentNode`, and a plain climb cycles through it forever — before
    // any refresh runs. Forced, because jsdom's override is not guaranteed.
    it("delivers a text change inside a <form> whose control shadows parentNode", async () => {
      document.body.innerHTML = `<form><input name="parentNode"><p>before</p></form>`;
      const form = document.querySelector("form")!;
      Object.defineProperty(form, "parentNode", {
        configurable: true,
        get: () => form.querySelector('[name="parentNode"]'),
      });
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      document.querySelector("p")!.firstChild!.textContent = "after";
      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("delivers a text change when a named <img> shadows document.parentNode", async () => {
      document.body.innerHTML = `<img name="parentNode" alt=""><p>before</p>`;
      const img = document.querySelector("img")!;
      Object.defineProperty(document, "parentNode", {
        configurable: true,
        get: () => img,
      });
      try {
        observer = new DomObserver(document.body, onTreeChange, 100);
        observer.start();

        document.querySelector("p")!.firstChild!.textContent = "after";
        await settleObserver(100);

        expect(onTreeChange).toHaveBeenCalledTimes(1);
      } finally {
        delete (document as unknown as Record<string, unknown>).parentNode;
      }
    });
  });

  // ── Form-control value observation ──────────────────────────────────────────────
  // MutationObserver doesn't see typing — `.value` is a property, not a DOM
  // attribute or text node. Without listening for `input`/`change`, the tree
  // would render stale values whenever a user typed into a field directly.
  describe("form-control value tracking", () => {
    it("fires onTreeChange when an input fires the input event", async () => {
      const input = document.createElement("input");
      document.body.appendChild(input);

      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      input.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(110);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("fires onTreeChange when a textarea fires the input event", async () => {
      const ta = document.createElement("textarea");
      document.body.appendChild(ta);

      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      ta.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(110);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("fires onTreeChange when a select fires the change event", async () => {
      const select = document.createElement("select");
      const opt = document.createElement("option");
      opt.value = "a";
      select.appendChild(opt);
      document.body.appendChild(select);

      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      select.dispatchEvent(new Event("change", { bubbles: true }));
      vi.advanceTimersByTime(110);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("debounces a burst of keystrokes into one re-extract", async () => {
      const input = document.createElement("input");
      document.body.appendChild(input);

      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      for (let i = 0; i < 5; i++) {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      vi.advanceTimersByTime(110);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("still hears input events that stop propagation (capture phase)", async () => {
      const input = document.createElement("input");
      document.body.appendChild(input);
      // A page handler that swallows the event before it bubbles.
      input.addEventListener("input", (e) => e.stopPropagation());

      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      input.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(110);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("removes the input listener on stop()", async () => {
      const input = document.createElement("input");
      document.body.appendChild(input);

      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();
      observer.stop();

      input.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(110);

      expect(onTreeChange).not.toHaveBeenCalled();
    });
  });

  describe("stop", () => {
    it("disconnects and cancels pending debounce", async () => {
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      const div = document.createElement("div");
      document.body.appendChild(div);

      // Stop before the debounce fires
      observer.stop();

      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    it("is safe to call before start", () => {
      observer = new DomObserver(document.body, onTreeChange);
      expect(() => observer.stop()).not.toThrow();
    });

    it("is safe to call multiple times", () => {
      observer = new DomObserver(document.body, onTreeChange);
      observer.start();
      observer.stop();
      expect(() => observer.stop()).not.toThrow();
    });
  });

  // `start()` has to be idempotent because it is the arming step of a
  // lifecycle a consumer drives, and nothing stops it being driven twice —
  // a re-arm after a root swap, a double-mount, a reconnect. Each call used
  // to construct a fresh set of observers and listeners over the OLD ones,
  // which stayed connected with nothing left holding them: they kept
  // recording mutations into the shared pending buffer and re-arming the
  // shared debounce, and `stop()` could only ever tear down the last set.
  describe("restart (start called twice without stop)", () => {
    it("stop() after a second start() leaves nothing observing", async () => {
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();
      observer.start();
      observer.stop();

      document.body.appendChild(document.createElement("div"));

      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    it("stop() after a second start() removes the input listener", () => {
      const input = document.createElement("input");
      document.body.appendChild(input);

      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();
      observer.start();
      observer.stop();

      input.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(110);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    it("does not record one mutation twice after a second start()", async () => {
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();
      observer.start();

      document.body.appendChild(document.createElement("div"));

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
      const change = onTreeChange.mock.calls[0]![0] as TreeChange;
      expect(change.mutations).toHaveLength(1);
    });

    // Why the guard is an early return and not a `this.stop()` restart:
    // `portalObserver` adopts a portal only on the `childList` record that
    // mounts it, so an overlay that is already open would never be re-adopted
    // by the second `start()` — its interior would silently stop being
    // observed, and the emptied-wrapper teardown keyed on
    // `portalContentObservers` identity would lose its key too.
    it("keeps observing an open portal's interior across a second start()", async () => {
      const appRoot = document.createElement("div");
      document.body.appendChild(appRoot);

      observer = new DomObserver(appRoot, onTreeChange, 100);
      observer.start();

      const portal = document.createElement("div");
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      portal.appendChild(dialog);
      document.body.appendChild(portal);
      await settleObserver(100); // the mount itself fired

      observer.start();
      onTreeChange.mockClear();

      dialog.appendChild(document.createElement("button"));
      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });
  });

  // Modal dialogs from React Portal (Radix, Headless UI), Vue Teleport,
  // etc. mount into `document.body` outside the configured root. Without
  // the secondary `document.body` observer, the extractor never knew the
  // modal had opened and the panel stayed on the trigger's pre-open state.
  describe("portal-mounted modals", () => {
    let appRoot: HTMLElement;

    beforeEach(() => {
      appRoot = document.createElement("div");
      appRoot.id = "app-root";
      document.body.appendChild(appRoot);
    });

    it("fires when an [aria-modal] element is appended to <body> outside the root", async () => {
      observer = new DomObserver(appRoot, onTreeChange, 100);
      observer.start();

      // Simulate what Radix does on open: render a portal wrapper into
      // document.body containing the dialog with aria-modal="true".
      const portal = document.createElement("div");
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.textContent = "Modal content";
      portal.appendChild(dialog);
      document.body.appendChild(portal);

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("fires when the portal wrapper is itself the [aria-modal] element", async () => {
      observer = new DomObserver(appRoot, onTreeChange, 100);
      observer.start();

      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      document.body.appendChild(dialog);

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalled();
    });

    it("fires when a native <dialog> is appended to <body>", async () => {
      observer = new DomObserver(appRoot, onTreeChange, 100);
      observer.start();

      const dialog = document.createElement("dialog");
      document.body.appendChild(dialog);

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalled();
    });

    it("fires on removal of a portal-mounted modal (close)", async () => {
      const portal = document.createElement("div");
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      portal.appendChild(dialog);
      document.body.appendChild(portal);

      observer = new DomObserver(appRoot, onTreeChange, 100);
      observer.start();

      portal.remove();

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalled();
    });

    it("ignores body-level mutations that are not modal-shaped", async () => {
      observer = new DomObserver(appRoot, onTreeChange, 100);
      observer.start();

      // A plain script/style/div appended to body — not a portal modal.
      const plain = document.createElement("div");
      plain.textContent = "just a div";
      document.body.appendChild(plain);

      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    it("ignores our own injected overlay/curtain elements", async () => {
      observer = new DomObserver(appRoot, onTreeChange, 100);
      observer.start();

      const highlight = document.createElement("div");
      highlight.id = "__sn-highlight";
      // Even if this element somehow contained an aria-modal descendant
      // (it shouldn't, but defense-in-depth), it's filtered out by id.
      document.body.appendChild(highlight);

      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    it("stop() disconnects the portal observer", async () => {
      observer = new DomObserver(appRoot, onTreeChange, 100);
      observer.start();
      observer.stop();

      const dialog = document.createElement("div");
      dialog.setAttribute("aria-modal", "true");
      document.body.appendChild(dialog);

      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    // Deep observation: when `root` is a subtree (the React hook / inspector
    // pass a user root, unlike the extension which passes documentElement),
    // the portal mounts OUTSIDE root, so the primary observer can't see into
    // it. Without a per-portal observer, the modal's open/close re-extracts
    // but nothing inside it does — the panel shows the initial state and goes
    // stale.
    describe("deep content observation (portal outside root)", () => {
      function openPortalModal(): HTMLElement {
        const portal = document.createElement("div");
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.innerHTML = "<p>Initial</p>";
        portal.appendChild(dialog);
        document.body.appendChild(portal);
        return dialog;
      }

      it("fires on a child added INSIDE an open portal, not just its mount", async () => {
        observer = new DomObserver(appRoot, onTreeChange, 100);
        observer.start();

        const dialog = openPortalModal();
        await settleObserver(100); // the mount itself fired
        onTreeChange.mockClear();

        dialog.appendChild(document.createElement("button"));
        await settleObserver(100);

        expect(onTreeChange).toHaveBeenCalledTimes(1);
      });

      it("fires on an aria-* flip inside an open portal", async () => {
        observer = new DomObserver(appRoot, onTreeChange, 100);
        observer.start();

        const dialog = openPortalModal();
        const btn = document.createElement("button");
        btn.setAttribute("aria-expanded", "false");
        dialog.appendChild(btn);
        await settleObserver(100);
        onTreeChange.mockClear();

        btn.setAttribute("aria-expanded", "true");
        await settleObserver(100);

        expect(onTreeChange).toHaveBeenCalledTimes(1);
      });

      it("fires on typing (input event) inside an open portal", async () => {
        observer = new DomObserver(appRoot, onTreeChange, 100);
        observer.start();

        const dialog = openPortalModal();
        const input = document.createElement("input");
        dialog.appendChild(input);
        await settleObserver(100);
        onTreeChange.mockClear();

        input.dispatchEvent(new Event("input", { bubbles: true }));
        vi.advanceTimersByTime(110);

        expect(onTreeChange).toHaveBeenCalledTimes(1);
      });

      it("stops observing a portal's contents after it unmounts", async () => {
        observer = new DomObserver(appRoot, onTreeChange, 100);
        observer.start();

        // Mount the dialog directly at body top level so its removal is the
        // node the portal observer sees.
        const dialog = document.createElement("div");
        dialog.setAttribute("aria-modal", "true");
        document.body.appendChild(dialog);
        await settleObserver(100);

        dialog.remove();
        await settleObserver(100); // close fired
        onTreeChange.mockClear();

        // The detached dialog is no longer watched — mutating it does nothing.
        dialog.appendChild(document.createElement("span"));
        await settleObserver(100);

        expect(onTreeChange).not.toHaveBeenCalled();
      });

      it("stop() disconnects portal content observers", async () => {
        observer = new DomObserver(appRoot, onTreeChange, 100);
        observer.start();

        const dialog = openPortalModal();
        await settleObserver(100);
        observer.stop();
        onTreeChange.mockClear();

        dialog.appendChild(document.createElement("span"));
        await settleObserver(100);

        expect(onTreeChange).not.toHaveBeenCalled();
      });

      it("tears down when the wrapper is removed with the dialog still inside", async () => {
        // Whole-tree unmount: the tracked key is the wrapper, and it's still
        // overlay-shaped at removal time.
        observer = new DomObserver(appRoot, onTreeChange, 100);
        observer.start();

        const portal = document.createElement("div");
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        portal.appendChild(dialog);
        document.body.appendChild(portal);
        await settleObserver(100);

        portal.remove();
        await settleObserver(100);
        onTreeChange.mockClear();

        dialog.appendChild(document.createElement("span"));
        await settleObserver(100);
        expect(onTreeChange).not.toHaveBeenCalled();
      });

      it("tears down even when the dialog is removed BEFORE its wrapper (exit-animation order)", async () => {
        // Radix Presence / Headless UI Transition remove the role-bearing
        // child first, then the now-empty wrapper. The wrapper is the tracked
        // key but no longer matches the overlay selector — teardown must key
        // on identity, not shape, or the observer + capture listeners leak.
        observer = new DomObserver(appRoot, onTreeChange, 100);
        observer.start();

        const portal = document.createElement("div");
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        const input = document.createElement("input");
        dialog.appendChild(input);
        portal.appendChild(dialog);
        document.body.appendChild(portal);
        await settleObserver(100);

        dialog.remove(); // inner removed first — wrapper is now empty
        await settleObserver(100);
        portal.remove(); // then the empty wrapper detaches
        await settleObserver(100);
        onTreeChange.mockClear();

        // If the wrapper observer leaked, this childList change would fire.
        portal.appendChild(document.createElement("span"));
        await settleObserver(100);
        expect(onTreeChange).not.toHaveBeenCalled();

        // And if its capture-phase input listener leaked, this would fire.
        input.dispatchEvent(new Event("input", { bubbles: true }));
        vi.advanceTimersByTime(110);
        expect(onTreeChange).not.toHaveBeenCalled();
      });
    });
  });

  // The selector that drives the secondary observer covers non-modal
  // overlays too: dropdown menus, listboxes, tooltips, and live-region
  // toasts. These tests pin the wider role set so a typo or accidental
  // narrowing would surface here.
  describe("portal-mounted non-modal overlays", () => {
    let appRoot: HTMLElement;

    beforeEach(() => {
      appRoot = document.createElement("div");
      appRoot.id = "app-root";
      document.body.appendChild(appRoot);
    });

    it("fires when a [role='menu'] is portal-mounted to <body>", async () => {
      observer = new DomObserver(appRoot, onTreeChange, 100);
      observer.start();

      const portal = document.createElement("div");
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      portal.appendChild(menu);
      document.body.appendChild(portal);

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("fires when a [role='listbox'] popover is portal-mounted", async () => {
      observer = new DomObserver(appRoot, onTreeChange, 100);
      observer.start();

      const listbox = document.createElement("div");
      listbox.setAttribute("role", "listbox");
      document.body.appendChild(listbox);

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalled();
    });

    it("fires when a [role='status'] live-region toast is portal-mounted", async () => {
      observer = new DomObserver(appRoot, onTreeChange, 100);
      observer.start();

      const toast = document.createElement("div");
      toast.setAttribute("role", "status");
      toast.textContent = "Saved successfully";
      document.body.appendChild(toast);

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalled();
    });

    it("fires when an [aria-live] element is portal-mounted", async () => {
      observer = new DomObserver(appRoot, onTreeChange, 100);
      observer.start();

      const live = document.createElement("div");
      live.setAttribute("aria-live", "polite");
      document.body.appendChild(live);

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalled();
    });

    it("fires when a <track>'s kind changes (drives the hoisted captions property)", async () => {
      // captions → metadata flips the media node's captions flag from
      // "true" to "false"; the mutation target is the <track>, which is
      // never a tree node, so LiveTreeExtractor falls back to a full
      // re-extract — but only if the attribute change is observed at all.
      appRoot.innerHTML =
        '<video controls src="x.mp4"><track kind="captions" src="c.vtt"></video>';
      observer = new DomObserver(appRoot, onTreeChange, 100);
      observer.start();

      appRoot.querySelector("track")!.setAttribute("kind", "metadata");

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("still ignores plain body-level mutations with no overlay role", async () => {
      observer = new DomObserver(appRoot, onTreeChange, 100);
      observer.start();

      // Generic widgets (analytics pixel, third-party script wrapper) carry
      // none of the overlay roles in the selector — must not trigger a re-extract.
      const widget = document.createElement("div");
      widget.className = "analytics-pixel";
      widget.textContent = "tracking";
      document.body.appendChild(widget);

      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });
  });

  describe("state attributes the extractor records", () => {
    // These flip IN PLACE on an element that is already in the tree — there is
    // no childList mutation to fall back on, so the tree only refreshes if the
    // attribute itself is in the observer's filter.
    it("fires when aria-current moves on an SPA route change", async () => {
      document.body.innerHTML = `
        <nav>
          <a id="home" href="/" aria-current="page">Home</a>
          <a id="about" href="/about">About</a>
        </nav>
      `;
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      document.getElementById("home")!.removeAttribute("aria-current");
      document.getElementById("about")!.setAttribute("aria-current", "page");

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("fires when aria-required toggles on a field", async () => {
      document.body.innerHTML = '<input id="email" aria-required="false" />';
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      document.getElementById("email")!.setAttribute("aria-required", "true");

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("fires when aria-busy toggles on a region", async () => {
      document.body.innerHTML = '<section id="results">Results</section>';
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      document.getElementById("results")!.setAttribute("aria-busy", "true");

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("fires when aria-readonly toggles on a field", async () => {
      document.body.innerHTML = '<input id="name" aria-readonly="true" />';
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      document.getElementById("name")!.setAttribute("aria-readonly", "false");

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("fires when a control's placeholder changes", async () => {
      document.body.innerHTML = '<input id="q" />';
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      document.getElementById("q")!.setAttribute("placeholder", "Search…");

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("fires when a control's name changes", async () => {
      document.body.innerHTML = '<input id="q" name="query" />';
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      document.getElementById("q")!.setAttribute("name", "search");

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });
  });

  describe("attributes the pipeline reads without recording", () => {
    // Not in the extractor's two lists — they feed name/role computation and
    // the value redaction — so the union doesn't cover them and they have to
    // be observed explicitly.
    it("fires when aria-description changes", async () => {
      document.body.innerHTML =
        '<button id="save" aria-description="Saves the draft">Save</button>';
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      document
        .getElementById("save")!
        .setAttribute("aria-description", "Publishes the draft");

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("fires when aria-level changes on a heading", async () => {
      document.body.innerHTML =
        '<div id="h" role="heading" aria-level="2">Section</div>';
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      document.getElementById("h")!.setAttribute("aria-level", "3");

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("fires when a th's scope changes (it selects the header role)", async () => {
      document.body.innerHTML =
        '<table><tr><th id="th" scope="col">Q1</th></tr></table>';
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      document.getElementById("th")!.setAttribute("scope", "row");

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("fires when an input's list changes (a datalist makes it a combobox)", async () => {
      document.body.innerHTML =
        '<input id="fruit"><datalist id="fruits"><option value="Apple"></datalist>';
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      document.getElementById("fruit")!.setAttribute("list", "fruits");

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("fires when autocomplete marks a field sensitive", async () => {
      // The field's value is redacted once autocomplete names a credential or
      // payment field — which only takes effect on the next extraction.
      document.body.innerHTML = '<input id="card" />';
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      document
        .getElementById("card")!
        .setAttribute("autocomplete", "cc-number");

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    // What a control invokes decides its expanded state.
    it.each([
      ["popovertarget", "b"],
      ["commandfor", "b"],
      ["command", "show-popover"],
      ["form", "f"],
    ])("fires when an invoker's %s changes", async (attr, value) => {
      document.body.innerHTML = `<form id="f"></form><button id="menu" popovertarget="a" commandfor="a" command="toggle-popover">Menu</button><div id="a" popover>x</div><div id="b" popover>y</div>`;
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      document.getElementById("menu")!.setAttribute(attr, value);

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("fires when an element stops being a popover", async () => {
      document.body.innerHTML = `<div id="menu" popover>x</div>`;
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      document.getElementById("menu")!.removeAttribute("popover");

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });
  });

  // A popover shows and hides with no attribute changing anywhere, so only
  // its `toggle` event says so. It doesn't bubble.
  describe("popover toggles", () => {
    function toggle(el: Element): void {
      el.dispatchEvent(new Event("toggle"));
    }

    it("hears a <form> popover whose field shadows hasAttribute", () => {
      document.body.innerHTML = `<form id="menu" popover><input name="hasAttribute" /></form>`;
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      const menu = document.getElementById("menu")!;
      clobber(menu, "hasAttribute");
      toggle(menu);
      vi.advanceTimersByTime(110);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
      expect(onTreeChange.mock.calls[0][0].dirtyRoots).toEqual([menu]);
    });

    it("fires with the popover as a dirty root", () => {
      document.body.innerHTML = `<main><div id="menu" popover>x</div></main>`;
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      const menu = document.getElementById("menu")!;
      toggle(menu);
      vi.advanceTimersByTime(110);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
      expect(onTreeChange.mock.calls[0][0].dirtyRoots).toEqual([menu]);
    });

    it("hears a popover outside the root", () => {
      document.body.innerHTML = `<main><button popovertarget="menu">Menu</button></main><div id="menu" popover>x</div>`;
      observer = new DomObserver(
        document.querySelector("main")!,
        onTreeChange,
        100,
      );
      observer.start();

      toggle(document.getElementById("menu")!);
      vi.advanceTimersByTime(110);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    it("ignores a toggle on anything else, which changes its open attribute too", () => {
      document.body.innerHTML = `<details id="d"><summary>S</summary>x</details>`;
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      toggle(document.getElementById("d")!);
      vi.advanceTimersByTime(110);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    it("asks for a full extraction when a popover outside the root stops being one", async () => {
      document.body.innerHTML = `<main><button popovertarget="menu">Menu</button></main><div id="menu" popover>x</div>`;
      observer = new DomObserver(
        document.querySelector("main")!,
        onTreeChange,
        100,
      );
      observer.start();

      document.getElementById("menu")!.removeAttribute("popover");
      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
      expect(onTreeChange.mock.calls[0][0].full).toBe(true);
    });

    it("leaves a popover attribute inside the root to the incremental path", async () => {
      document.body.innerHTML = `<main><div id="menu" popover>x</div></main>`;
      observer = new DomObserver(document.body, onTreeChange, 100);
      observer.start();

      document.getElementById("menu")!.removeAttribute("popover");
      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
      expect(onTreeChange.mock.calls[0][0].full).toBeUndefined();
    });

    it("stops listening on stop()", async () => {
      document.body.innerHTML = `<main></main><div id="menu" popover>x</div>`;
      observer = new DomObserver(
        document.querySelector("main")!,
        onTreeChange,
        100,
      );
      observer.start();
      observer.stop();

      const menu = document.getElementById("menu")!;
      toggle(menu);
      menu.removeAttribute("popover");
      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });
  });

  // Apps commonly mount a <dialog> once, beside the element the panel observes,
  // and open it with showModal(). Extraction pivots onto an open modal wherever
  // it sits, but opening or closing one mounts nothing and changes only its
  // `open` attribute, outside the root, so nothing reported it: the tree stayed
  // on the page under an open modal, and on the dialog after it closed.
  // jsdom has no showModal(), so these flip `open` the way it does.
  describe("a <dialog> mounted outside the root", () => {
    function observeApp(): void {
      observer = new DomObserver(
        document.getElementById("app")!,
        onTreeChange,
        100,
      );
      observer.start();
    }

    /**
     * jsdom never matches `:modal`, so make `dialog` match it while it is
     * open and in the document, as one opened with showModal() does until it
     * closes or is removed.
     */
    function asModal(dialog: Element): void {
      const matches = Element.prototype.matches;
      vi.spyOn(Element.prototype, "matches").mockImplementation(function (
        this: Element,
        selector: string,
      ) {
        return selector === ":modal"
          ? this === dialog && this.isConnected && this.hasAttribute("open")
          : matches.call(this, selector);
      });
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    // Every modal test below relies on this: were `isModal` to read `:modal`
    // through a method captured at load, the stub would stop reaching it and
    // those tests would check the non-modal path without failing.
    it("fakes :modal where the extractor reads it", () => {
      document.body.innerHTML = `<dialog id="dlg" open>x</dialog>`;
      const dlg = document.getElementById("dlg")!;
      asModal(dlg);

      expect(isModal(dlg)).toBe(true);
    });

    it("asks for a full extraction when it opens", async () => {
      document.body.innerHTML = `<main id="app"><button>Open</button></main><dialog id="dlg"><button>Confirm</button></dialog>`;
      observeApp();

      document.getElementById("dlg")!.setAttribute("open", "");
      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
      expect(onTreeChange.mock.calls[0][0].full).toBe(true);
    });

    it("asks for a full extraction when it closes", async () => {
      document.body.innerHTML = `<main id="app"><button>Open</button></main><dialog id="dlg" open><button>Confirm</button></dialog>`;
      observeApp();

      document.getElementById("dlg")!.removeAttribute("open");
      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
      expect(onTreeChange.mock.calls[0][0].full).toBe(true);
    });

    it("hears one inside a container rather than directly in <body>", async () => {
      document.body.innerHTML = `<main id="app"></main><div id="modals"><div><dialog id="dlg">x</dialog></div></div>`;
      observeApp();

      document.getElementById("dlg")!.setAttribute("open", "");
      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
      expect(onTreeChange.mock.calls[0][0].full).toBe(true);
    });

    // An open modal IS the tree, so a change inside it has to refresh it, as
    // one inside a portal-mounted overlay does.
    it("watches inside it while it is open as a modal", async () => {
      document.body.innerHTML = `<main id="app"></main><dialog id="dlg"><p>Initial</p></dialog>`;
      const dlg = document.getElementById("dlg")!;
      asModal(dlg);
      observeApp();
      dlg.setAttribute("open", "");
      await settleObserver(100);
      onTreeChange.mockClear();

      dlg.appendChild(document.createElement("button"));
      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
      expect(onTreeChange.mock.calls[0][0].mutations).toHaveLength(1);
    });

    it("hears typing inside it while it is open as a modal", async () => {
      document.body.innerHTML = `<main id="app"></main><dialog id="dlg"><input id="name" /></dialog>`;
      const dlg = document.getElementById("dlg")!;
      asModal(dlg);
      observeApp();
      dlg.setAttribute("open", "");
      await settleObserver(100);
      onTreeChange.mockClear();

      const input = document.getElementById("name")!;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
      expect(onTreeChange.mock.calls[0][0].dirtyRoots).toEqual([input]);
    });

    it("watches inside one that was already a modal when observing started", async () => {
      document.body.innerHTML = `<main id="app"></main><dialog id="dlg" open><p>Initial</p></dialog>`;
      const dlg = document.getElementById("dlg")!;
      asModal(dlg);
      observeApp();

      dlg.appendChild(document.createElement("p"));
      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    // A non-modal dialog is never the whole tree, and when it isn't in the
    // tree at all, each change inside it would cost a full re-extraction.
    it("does not watch inside one opened without showModal()", async () => {
      document.body.innerHTML = `<main id="app"></main><dialog id="dlg"><input id="name" /></dialog>`;
      observeApp();
      const dlg = document.getElementById("dlg")!;
      dlg.setAttribute("open", "");
      await settleObserver(100);
      // Opening still asks for a full extraction: an explicit role="dialog"
      // would widen the scope to take it in.
      expect(onTreeChange).toHaveBeenCalledTimes(1);
      onTreeChange.mockClear();

      dlg.appendChild(document.createElement("p"));
      document
        .getElementById("name")!
        .dispatchEvent(new Event("input", { bubbles: true }));
      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    it("stops watching inside it once it closes", async () => {
      document.body.innerHTML = `<main id="app"></main><dialog id="dlg" open><input id="name" /></dialog>`;
      const dlg = document.getElementById("dlg")!;
      asModal(dlg);
      observeApp();
      dlg.removeAttribute("open");
      await settleObserver(100);
      onTreeChange.mockClear();

      dlg.appendChild(document.createElement("p"));
      document
        .getElementById("name")!
        .dispatchEvent(new Event("input", { bubbles: true }));
      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    it("stops watching inside it when its wrapper leaves <body> with it open", async () => {
      document.body.innerHTML = `<main id="app"></main><div id="wrapper"><dialog id="dlg" open>x</dialog></div>`;
      const dlg = document.getElementById("dlg")!;
      asModal(dlg);
      observeApp();
      document.getElementById("wrapper")!.remove();
      await settleObserver(100);
      onTreeChange.mockClear();

      dlg.appendChild(document.createElement("p"));
      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    // `{open && createPortal(<dialog />, modalRoot)}`: the dialog leaves a
    // container that stays, changing no attribute and not <body>'s children.
    it("asks for a full extraction when it is removed from a container while open", async () => {
      document.body.innerHTML = `<main id="app"></main><div id="modal-root"><dialog id="dlg" open>x</dialog></div>`;
      const dlg = document.getElementById("dlg")!;
      asModal(dlg);
      observeApp();

      dlg.remove();
      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
      expect(onTreeChange.mock.calls[0][0].full).toBe(true);

      // And it is no longer watched.
      onTreeChange.mockClear();
      dlg.appendChild(document.createElement("p"));
      await settleObserver(100);
      expect(onTreeChange).not.toHaveBeenCalled();
    });

    // Moving it ends its modality, so a modal here was closed and shown again
    // after the move, in the same task, before any observer callback ran.
    // Observer callbacks run in the order the observers were made, so which
    // one hears the move first depends on where the dialog sat and whether it
    // was open before observing started.
    it.each([
      [
        "from a container, opened after start",
        `<div id="modal-root"><dialog id="dlg">x</dialog></div>`,
      ],
      ["from <body>, opened after start", `<dialog id="dlg">x</dialog>`],
      ["from <body>, open at start", `<dialog id="dlg" open>x</dialog>`],
    ])(
      "keeps watching one that is a modal again after moving elsewhere outside the root (%s)",
      async (_, markup) => {
        document.body.innerHTML = `<main id="app"></main>${markup}<div id="other"></div>`;
        const dlg = document.getElementById("dlg")!;
        asModal(dlg);
        observeApp();
        dlg.setAttribute("open", "");
        await settleObserver(100);

        document.getElementById("other")!.appendChild(dlg);
        await settleObserver(100);
        onTreeChange.mockClear();

        dlg.appendChild(document.createElement("p"));
        await settleObserver(100);
        expect(onTreeChange).toHaveBeenCalledTimes(1);

        // And its next removal, from the new parent, is heard too.
        onTreeChange.mockClear();
        dlg.remove();
        await settleObserver(100);
        expect(onTreeChange).toHaveBeenCalledTimes(1);
        expect(onTreeChange.mock.calls[0][0].full).toBe(true);
      },
    );

    // A <dialog role="alertdialog"> portalled into <body> and opened with
    // show() widens the tree to take it in, so the watch the portal path
    // gave it on mounting has to survive its opening.
    it("keeps the watch a <dialog> mounted into <body> got, when it opens with show()", async () => {
      document.body.innerHTML = `<main id="app"></main>`;
      observeApp();
      const dlg = document.createElement("dialog");
      dlg.setAttribute("role", "alertdialog");
      dlg.innerHTML = "<p>Saved</p>";
      document.body.appendChild(dlg);
      await settleObserver(100);

      dlg.setAttribute("open", "");
      await settleObserver(100);
      onTreeChange.mockClear();

      dlg.appendChild(document.createElement("button"));
      await settleObserver(100);
      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });

    // A root inside a modal: the modal is the tree, but the primary observer
    // already reports what changes inside the root.
    it("does not watch inside a modal that holds the root, so nothing is reported twice", async () => {
      document.body.innerHTML = `<dialog id="dlg" open><div id="app"><p>x</p></div></dialog>`;
      const dlg = document.getElementById("dlg")!;
      asModal(dlg);
      observeApp();

      document.getElementById("app")!.appendChild(document.createElement("p"));
      await settleObserver(100);
      expect(onTreeChange).toHaveBeenCalledTimes(1);
      expect(onTreeChange.mock.calls[0][0].mutations).toHaveLength(1);

      // Its closing still refreshes in full: the scope moves off it.
      onTreeChange.mockClear();
      dlg.removeAttribute("open");
      await settleObserver(100);
      expect(onTreeChange).toHaveBeenCalledTimes(1);
      expect(onTreeChange.mock.calls[0][0].full).toBe(true);
    });

    it("stops watching inside it once it moves into the root", async () => {
      document.body.innerHTML = `<main id="app"></main><div id="modal-root"><dialog id="dlg" open>x</dialog></div>`;
      const dlg = document.getElementById("dlg")!;
      asModal(dlg);
      observeApp();

      document.getElementById("app")!.appendChild(dlg);
      await settleObserver(100);
      onTreeChange.mockClear();

      // Only the primary observer reports it now: one batch, one record.
      dlg.appendChild(document.createElement("p"));
      await settleObserver(100);
      expect(onTreeChange).toHaveBeenCalledTimes(1);
      expect(onTreeChange.mock.calls[0][0].mutations).toHaveLength(1);
    });

    it("leaves a <dialog> inside the root to the incremental path", async () => {
      document.body.innerHTML = `<main id="app"><dialog id="dlg">x</dialog></main>`;
      observeApp();

      document.getElementById("dlg")!.setAttribute("open", "");
      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
      expect(onTreeChange.mock.calls[0][0].full).toBeUndefined();
    });

    // Bounded: only a <dialog> can take the scope by opening. A <details>
    // elsewhere on the page opening is not this tree's business.
    it("ignores a <details> outside the root opening", async () => {
      document.body.innerHTML = `<main id="app"></main><details id="d"><summary>S</summary>x</details>`;
      observeApp();

      document.getElementById("d")!.setAttribute("open", "");
      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    // A modal never takes the scope from a root inside a shadow tree.
    it("ignores one beside a root inside a shadow tree", async () => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const shadowRoot = host.attachShadow({ mode: "open" });
      shadowRoot.innerHTML = `<main id="app"></main><dialog id="dlg">x</dialog>`;
      const dlg = shadowRoot.getElementById("dlg")!;
      asModal(dlg);
      observer = new DomObserver(
        shadowRoot.getElementById("app")!,
        onTreeChange,
        100,
      );
      observer.start();

      dlg.setAttribute("open", "");
      await settleObserver(100);
      dlg.appendChild(document.createElement("p"));
      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    it("stops listening on stop()", async () => {
      document.body.innerHTML = `<main id="app"></main><dialog id="dlg" open>x</dialog>`;
      const dlg = document.getElementById("dlg")!;
      asModal(dlg);
      observeApp();
      observer.stop();

      dlg.appendChild(document.createElement("p"));
      dlg.removeAttribute("open");
      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });
  });

  describe("a <form> whose control shadows a method", () => {
    // `<form>` has [LegacyOverrideBuiltIns], so `<input name="getAttribute">`
    // makes `form.getAttribute` that input and calling it throws. The throw
    // escaped the MutationObserver callback, which lost the WHOLE batch — every
    // other change in it, not just the form's — and the tree went stale until
    // some later, unrelated mutation.
    it("keeps a batch that touches a form whose getAttribute is shadowed", async () => {
      document.body.innerHTML = `
        <main id="app">
          <form><input name="getAttribute" /></form>
          <p id="p">text</p>
        </main>
      `;
      const root = document.getElementById("app")!;
      const form = root.querySelector("form")!;
      clobber(form, "getAttribute");
      observer = new DomObserver(root, onTreeChange, 100);
      observer.start();

      form.setAttribute("class", "touched");
      document.getElementById("p")!.setAttribute("class", "touched");

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
      const change = onTreeChange.mock.calls[0][0] as TreeChange;
      expect(change.mutations?.map((m) => m.target)).toEqual([
        form,
        document.getElementById("p"),
      ]);
    });

    it("re-extracts in full when a form it cannot classify mounts into <body>", async () => {
      // The portal observer asks each node mounted into <body> whether it is
      // an overlay. A form whose control shadows `getAttribute` cannot say
      // what its role is — and this one holds a dialog, which has to pivot
      // the tree.
      const appRoot = document.createElement("div");
      document.body.appendChild(appRoot);
      observer = new DomObserver(appRoot, onTreeChange, 100);
      observer.start();

      const form = document.createElement("form");
      form.innerHTML = `<input name="getAttribute" /><div role="dialog" aria-label="Offer">Hi</div>`;
      clobber(form, "getAttribute");
      document.body.appendChild(form);

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
      expect(onTreeChange.mock.calls[0][0]).toMatchObject({ full: true });
    });

    it("classifies a plain form mounted into <body> although its control shadows matches", async () => {
      // `matches` is the first thing the overlay check asks. A form that could
      // not answer counted as a portal, so every such form mounting outside
      // the root re-extracted the whole page for nothing.
      const appRoot = document.createElement("div");
      document.body.appendChild(appRoot);
      observer = new DomObserver(appRoot, onTreeChange, 100);
      observer.start();

      const form = document.createElement("form");
      form.innerHTML = `<input name="matches" aria-label="Search" />`;
      clobber(form, "matches");
      document.body.appendChild(form);

      await settleObserver(100);

      expect(onTreeChange).not.toHaveBeenCalled();
    });

    it("starts on a form root whose control shadows contains", () => {
      // Whether the root already holds <body> decides if the portal observer
      // is needed at all; asking the form threw out of start().
      document.body.innerHTML = `<form aria-label="Signup"><input name="contains" /></form>`;
      const form = document.querySelector("form")!;
      clobber(form, "contains");
      observer = new DomObserver(form, onTreeChange, 100);

      expect(() => observer.start()).not.toThrow();
    });

    it("re-extracts when an overlay mounts beside a form root whose control shadows contains", async () => {
      // A mounted overlay is watched only when it lies outside the root, and
      // asking the form threw inside the portal observer, losing the batch.
      document.body.innerHTML = `<form aria-label="Signup"><input name="contains" /></form>`;
      const form = document.querySelector("form")!;
      clobber(form, "contains");
      observer = new DomObserver(form, onTreeChange, 100);
      observer.start();

      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<button role="menuitem">Rename</button>`;
      document.body.appendChild(menu);

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
      expect(onTreeChange.mock.calls[0][0]).toMatchObject({ full: true });
    });
  });

  describe("a <form> whose control shadows nodeType", () => {
    // `form.nodeType` reads as the control, not 1, so the portal observer took
    // a form mounted into <body> for no element at all and never asked whether
    // it was an overlay: the dialog opened and the tree stayed as it was.
    it("re-extracts in full when such a form mounts into <body> as a dialog", async () => {
      const appRoot = document.createElement("div");
      document.body.appendChild(appRoot);
      observer = new DomObserver(appRoot, onTreeChange, 100);
      observer.start();

      const form = document.createElement("form");
      form.setAttribute("role", "dialog");
      form.setAttribute("aria-label", "Sign in");
      form.innerHTML = `<input type="hidden" name="nodeType" /><button>Go</button>`;
      shadow(form, "nodeType");
      document.body.appendChild(form);

      await settleObserver(100);

      expect(onTreeChange).toHaveBeenCalledTimes(1);
      expect(onTreeChange.mock.calls[0][0]).toMatchObject({ full: true });
    });
  });
});
