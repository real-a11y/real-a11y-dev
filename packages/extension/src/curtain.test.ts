import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { liftCurtain, showCurtain } from "./curtain.js";

const curtain = () => document.getElementById("__sn-curtain");

/** What a frame takes: long enough for the frame callback, whichever timer
 *  stands in for `requestAnimationFrame`. Microtasks run on the way. */
const nextFrame = () => vi.advanceTimersByTimeAsync(20);

describe("the screen curtain", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    liftCurtain(document);
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("covers the page from the document's root element, once", () => {
    showCurtain(document.documentElement);
    showCurtain(document.documentElement);
    expect(document.querySelectorAll("#__sn-curtain")).toHaveLength(1);
    expect(document.documentElement.lastElementChild).toBe(curtain());
    expect(curtain()!.textContent).toContain("Screen Curtain");
  });

  it("holds its place against the page's own rules: every declaration is important", () => {
    showCurtain(document.documentElement);
    const { style } = curtain()!;
    expect(style.getPropertyValue("position")).toBe("fixed");
    expect(style.getPropertyPriority("position")).toBe("important");
    expect(style.getPropertyValue("background-color")).not.toBe("");
    expect(style.getPropertyPriority("background-color")).toBe("important");
    expect(style.getPropertyValue("z-index")).toBe("2147483647");
    expect(style.getPropertyPriority("z-index")).toBe("important");
  });

  it("takes the page out of hit testing while it is up, and only then", () => {
    showCurtain(document.documentElement);
    const sheet = curtain()!.querySelector("style");
    expect(sheet?.textContent).toMatch(
      /\*, ::backdrop \{ pointer-events: none !important; \}/,
    );
    liftCurtain(document);
    expect(document.querySelector("style")).toBeNull();
  });

  it("is no part of Chrome's tree of the page", () => {
    showCurtain(document.documentElement);
    expect(curtain()!.getAttribute("aria-hidden")).toBe("true");
  });

  it("is lifted out of the document", () => {
    showCurtain(document.documentElement);
    liftCurtain(document);
    expect(curtain()).toBeNull();
  });

  it("where the browser has no popovers, covers with the highest z-index alone", () => {
    showCurtain(document.documentElement);
    expect(curtain()!.hasAttribute("popover")).toBe(false);
  });

  describe("in the top layer", () => {
    /** The top layer jsdom lacks: the popovers shown, in the order they
     *  entered it, the last on top. Showing and hiding fire `beforetoggle`
     *  first, as Chromium does, and do nothing to a popover already so. */
    let layer: Element[];
    /** Every element that entered the top layer, in order. */
    let entered: Element[];
    let observers: FakeObserver[];

    class FakeObserver {
      targets: Element[] = [];
      disconnected = false;
      constructor(
        readonly callback: (entries: unknown[]) => void,
        readonly init: Record<string, unknown>,
      ) {
        observers.push(this);
      }
      observe(target: Element) {
        this.targets.push(target);
      }
      disconnect() {
        this.disconnected = true;
      }
      /** A visibility check that finds each target covered, or not. */
      report(isVisible: boolean) {
        if (this.disconnected) return;
        this.callback(this.targets.map((target) => ({ target, isVisible })));
      }
    }

    const beforeToggle = (el: Element, newState: "open" | "closed") =>
      el.dispatchEvent(Object.assign(new Event("beforetoggle"), { newState }));

    /** `el`, connected, entering the top layer the way `showPopover` does. */
    function enter(el: Element): void {
      if (!el.isConnected) {
        throw new DOMException("Not connected", "InvalidStateError");
      }
      if (layer.includes(el)) return;
      beforeToggle(el, "open");
      layer.push(el);
      entered.push(el);
    }
    function leave(el: Element): void {
      if (!layer.includes(el)) return;
      beforeToggle(el, "closed");
      layer.splice(layer.indexOf(el), 1);
    }
    /** How many times the curtain entered the top layer. */
    const raises = () => entered.filter((el) => el === curtain()).length;

    /** A popover of the page's, in the body. */
    function pagePopover(): HTMLElement {
      const el = document.createElement("div");
      el.setAttribute("popover", "");
      document.body.append(el);
      return el;
    }

    beforeEach(() => {
      layer = [];
      entered = [];
      observers = [];
      Object.defineProperties(HTMLElement.prototype, {
        showPopover: {
          configurable: true,
          value(this: HTMLElement) {
            enter(this);
          },
        },
        hidePopover: {
          configurable: true,
          value(this: HTMLElement) {
            leave(this);
          },
        },
      });
      vi.stubGlobal("IntersectionObserver", FakeObserver);
    });

    afterEach(() => {
      // Lifted while the fakes still stand, as the outer afterEach would
      // after they are gone.
      liftCurtain(document);
      const proto = HTMLElement.prototype as Partial<HTMLElement>;
      delete proto.showPopover;
      delete proto.hidePopover;
      vi.unstubAllGlobals();
    });

    it("enters it as a manual popover, above every z-index of the page's", () => {
      showCurtain(document.documentElement);
      // Manual: no other popover's opening or light dismiss closes it, and
      // Escape doesn't either.
      expect(curtain()!.getAttribute("popover")).toBe("manual");
      expect(layer).toEqual([curtain()]);
    });

    it("goes back on top of the popovers a script shows, once the script has run", async () => {
      showCurtain(document.documentElement);
      const menu = pagePopover();
      const suggestions = pagePopover();
      menu.showPopover();
      suggestions.showPopover();
      expect(layer).toEqual([curtain(), menu, suggestions]);

      // Before any frame: a script that ran in a frame callback is followed
      // here too, before that frame paints.
      await Promise.resolve();
      expect(layer).toEqual([menu, suggestions, curtain()]);
      expect(raises()).toBe(2);
    });

    it("and before the next frame, over one the browser shows itself, from a popovertarget button", async () => {
      showCurtain(document.documentElement);
      const menu = pagePopover();
      // No script of the page's runs around it, so the microtask comes
      // between its beforetoggle and its entering.
      beforeToggle(menu, "open");
      await Promise.resolve();
      layer.push(menu);
      expect(layer.at(-1)).toBe(menu);

      await nextFrame();
      expect(layer).toEqual([menu, curtain()]);
    });

    it("goes back on top of a fullscreen element", async () => {
      showCurtain(document.documentElement);
      const video = document.createElement("video");
      document.body.append(video);
      layer.push(video);
      video.dispatchEvent(
        new Event("fullscreenchange", { bubbles: true, composed: true }),
      );
      await Promise.resolve();
      expect(layer).toEqual([video, curtain()]);
    });

    it("stays where it is when a popover of the page's closes", async () => {
      showCurtain(document.documentElement);
      const menu = pagePopover();
      menu.showPopover();
      await nextFrame();
      const before = raises();
      menu.hidePopover();
      await nextFrame();
      expect(raises()).toBe(before);
      expect(layer).toEqual([curtain()]);
    });

    it("keeps its own toggle events from the page", async () => {
      const heard: EventTarget[] = [];
      const hear = (e: Event) => heard.push(e.target!);
      for (const type of ["beforetoggle", "toggle"]) {
        document.addEventListener(type, hear, true);
      }
      try {
        showCurtain(document.documentElement);
        const menu = pagePopover();
        menu.showPopover();
        await nextFrame();
        // Chrome's toggle, which comes after a raise in a task of its own.
        curtain()!.dispatchEvent(new Event("toggle"));
        expect(raises()).toBeGreaterThan(1);
        expect(heard).toEqual([menu]);
      } finally {
        for (const type of ["beforetoggle", "toggle"]) {
          document.removeEventListener(type, hear, true);
        }
      }
    });

    it("goes back on top of a popover in a shadow root once the visibility check finds it covered", async () => {
      showCurtain(document.documentElement);
      const host = document.createElement("div");
      document.body.append(host);
      const inShadow = document.createElement("div");
      inShadow.setAttribute("popover", "");
      host.attachShadow({ mode: "open" }).append(inShadow);
      // Its beforetoggle stops at the shadow root, short of the window.
      inShadow.showPopover();
      await nextFrame();
      expect(layer).toEqual([curtain(), inShadow]);

      const [watch] = observers;
      expect(watch!.init).toMatchObject({ trackVisibility: true, delay: 100 });
      expect(watch!.targets).toEqual([curtain()]);
      watch!.report(true);
      await nextFrame();
      expect(layer).toEqual([curtain(), inShadow]);
      watch!.report(false);
      await nextFrame();
      expect(layer).toEqual([inShadow, curtain()]);
    });

    it("trades places at most 20 times a second with a script that answers each raise, and ends on top", async () => {
      // A script that keeps its own popover on top the same way, and hears
      // the curtain's raises: its listener went on the window's capture
      // phase before the curtain's.
      const toast = pagePopover();
      let answering = true;
      const answer = (e: Event) => {
        if (!answering || (e as ToggleEvent).newState !== "open") return;
        if (e.target === toast) return;
        setTimeout(() => {
          toast.hidePopover();
          toast.showPopover();
        });
      };
      addEventListener("beforetoggle", answer, true);
      try {
        showCurtain(document.documentElement);
        // 2.4 seconds of frames, so three seconds begun: 20 raises in each.
        for (let i = 0; i < 120; i++) await nextFrame();
        expect(raises()).toBeLessThanOrEqual(3 * 20);
        expect(raises()).toBeGreaterThan(20);

        answering = false;
        await vi.advanceTimersByTimeAsync(1000);
        expect(layer.at(-1)).toBe(curtain());
      } finally {
        removeEventListener("beforetoggle", answer, true);
      }
    });

    it("once lifted, stops going back on top", async () => {
      showCurtain(document.documentElement);
      const [watch] = observers;
      liftCurtain(document);
      expect(watch!.disconnected).toBe(true);

      const before = entered.length;
      pagePopover().showPopover();
      await nextFrame();
      expect(entered).toHaveLength(before + 1);
      expect(entered.at(-1)).not.toBe(curtain());
    });

    it("takes the place of a curtain an older script left, which a popover covers", () => {
      const old = document.createElement("div");
      old.id = "__sn-curtain";
      document.documentElement.append(old);
      showCurtain(document.documentElement);
      expect(old.isConnected).toBe(false);
      expect(document.querySelectorAll("#__sn-curtain")).toHaveLength(1);
      expect(layer).toEqual([curtain()]);
    });

    it("keeps the next curtain on top once a new root element replaced the old", async () => {
      showCurtain(document.documentElement);
      const [oldWatch] = observers;
      const html = document.createElement("html");
      html.append(document.createElement("body"));
      document.replaceChild(html, document.documentElement);
      // The old curtain went with the old root; the content script shows the
      // curtain again over the new one.
      expect(curtain()).toBeNull();
      showCurtain(html);
      expect(oldWatch!.disconnected).toBe(true);
      expect(observers.at(-1)!.targets).toEqual([curtain()]);

      const menu = pagePopover();
      menu.showPopover();
      await nextFrame();
      expect(layer.at(-1)).toBe(curtain());
    });
  });
});
