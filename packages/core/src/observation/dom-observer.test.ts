import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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

    it("custom internalIds extends the default sentinel set", async () => {
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
});
