import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { ElementRefMap } from "../utils/element-ref.js";

import { FocusManager } from "./focus-manager.js";

function mkFocusable() {
  const button = document.createElement("button");
  button.textContent = "click me";
  document.body.appendChild(button);
  return button;
}

describe("FocusManager", () => {
  let refs: ElementRefMap;
  let fm: FocusManager;

  beforeEach(() => {
    refs = new ElementRefMap();
    fm = new FocusManager(refs);
    // jsdom's getBoundingClientRect returns all zeros by default; fake a real
    // rect so position assertions don't all look like the same value.
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      top: 10,
      left: 20,
      width: 100,
      height: 40,
      right: 120,
      bottom: 50,
      x: 20,
      y: 10,
      toJSON: () => ({}),
    })) as unknown as Element["getBoundingClientRect"];
    // jsdom doesn't implement scrollIntoView — default options call it, so
    // stub to a no-op so tests don't crash.
    Element.prototype.scrollIntoView =
      vi.fn() as unknown as Element["scrollIntoView"];
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement
      .querySelectorAll("#__sn-highlight")
      .forEach((el) => el.remove());
  });

  describe("highlightElement", () => {
    it("creates the overlay element on first call", () => {
      const btn = mkFocusable();
      refs.set("sn-1", btn);

      fm.highlightElement("sn-1");

      const overlay = document.getElementById("__sn-highlight");
      expect(overlay).not.toBeNull();
    });

    it("positions the overlay using the element's bounding rect", () => {
      const btn = mkFocusable();
      refs.set("sn-1", btn);

      fm.highlightElement("sn-1");

      const overlay = document.getElementById("__sn-highlight")!;
      expect(overlay.style.top).toBe("10px");
      expect(overlay.style.left).toBe("20px");
      expect(overlay.style.width).toBe("100px");
      expect(overlay.style.height).toBe("40px");
    });

    it("does not create an overlay when { overlay: false }", () => {
      const btn = mkFocusable();
      refs.set("sn-1", btn);

      fm.highlightElement("sn-1", { overlay: false });

      expect(document.getElementById("__sn-highlight")).toBeNull();
    });

    it("is a no-op when the node id is unknown", () => {
      fm.highlightElement("sn-unknown");

      expect(document.getElementById("__sn-highlight")).toBeNull();
    });

    it("scrolls the focused element to the vertical center of the viewport", () => {
      // Regression: earlier the call used `block: "nearest"`, which only
      // scrolls until the element's nearest edge touches the viewport. With
      // a tall scrollable ancestor, that left the focused element jammed
      // against the bottom edge — sometimes off-screen entirely once the
      // browser's own focus()-induced scroll piled on top. Centering
      // vertically puts the user's attention in the middle of the viewport.
      const btn = mkFocusable();
      refs.set("sn-1", btn);
      const scrollSpy = btn.scrollIntoView as unknown as ReturnType<
        typeof vi.fn
      >;
      scrollSpy.mockClear();

      fm.highlightElement("sn-1");

      expect(scrollSpy).toHaveBeenCalledWith({
        block: "center",
        inline: "nearest",
      });
    });

    it("does not scroll when { scroll: false }", () => {
      const btn = mkFocusable();
      refs.set("sn-1", btn);
      const scrollSpy = btn.scrollIntoView as unknown as ReturnType<
        typeof vi.fn
      >;
      scrollSpy.mockClear();

      fm.highlightElement("sn-1", { scroll: false });

      expect(scrollSpy).not.toHaveBeenCalled();
    });

    it("reuses the existing overlay on subsequent calls", () => {
      const btn1 = mkFocusable();
      const btn2 = mkFocusable();
      refs.set("sn-1", btn1);
      refs.set("sn-2", btn2);

      fm.highlightElement("sn-1");
      const first = document.getElementById("__sn-highlight");

      fm.highlightElement("sn-2");
      const second = document.getElementById("__sn-highlight");

      // Same DOM element re-positioned, not a new one
      expect(first).toBe(second);
      // Still only one in the document
      expect(document.querySelectorAll("#__sn-highlight").length).toBe(1);
    });

    it("sets every property it needs over the page's own rules", () => {
      const btn = mkFocusable();
      refs.set("sn-1", btn);

      fm.highlightElement("sn-1");

      const { style } = document.getElementById("__sn-highlight")!;
      for (const property of ["position", "top", "left", "width", "height"]) {
        expect(style.getPropertyPriority(property)).toBe("important");
      }
    });

    it("where the browser has no popovers, draws with the highest z-index alone", () => {
      const btn = mkFocusable();
      refs.set("sn-1", btn);

      fm.highlightElement("sn-1");

      const overlay = document.getElementById("__sn-highlight")!;
      expect(overlay.hasAttribute("popover")).toBe(false);
      expect(overlay.style.zIndex).toBe("2147483647");
    });
  });

  describe("highlightElement in the top layer", () => {
    /** The top layer jsdom lacks: the popovers shown, in the order they
     *  entered it, the last on top. */
    let layer: Element[];
    const overlay = () => document.getElementById("__sn-highlight");

    /** A popover of the page's, in the body. */
    function pagePopover(): HTMLElement {
      const el = document.createElement("div");
      el.setAttribute("popover", "");
      document.body.append(el);
      return el;
    }

    beforeEach(() => {
      layer = [];
      Object.defineProperties(HTMLElement.prototype, {
        showPopover: {
          configurable: true,
          value(this: HTMLElement) {
            if (!this.hasAttribute("popover")) {
              throw new DOMException("Not a popover", "NotSupportedError");
            }
            if (!layer.includes(this)) layer.push(this);
          },
        },
        hidePopover: {
          configurable: true,
          value(this: HTMLElement) {
            if (layer.includes(this)) layer.splice(layer.indexOf(this), 1);
          },
        },
      });
      const matches = Element.prototype.matches;
      vi.spyOn(Element.prototype, "matches").mockImplementation(function (
        this: Element,
        selector: string,
      ) {
        return selector === ":popover-open"
          ? layer.includes(this)
          : matches.call(this, selector);
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      const proto = HTMLElement.prototype as Partial<HTMLElement>;
      delete proto.showPopover;
      delete proto.hidePopover;
    });

    it("enters it as a manual popover, above every z-index of the page's", () => {
      const btn = mkFocusable();
      refs.set("sn-1", btn);

      fm.highlightElement("sn-1");

      // Manual: it closes none of the page's popovers, and no light dismiss
      // or Escape closes it.
      expect(overlay()!.getAttribute("popover")).toBe("manual");
      expect(layer).toEqual([overlay()]);
    });

    it("goes over a menu the page shows as a popover, and leaves it open", () => {
      // The reported case: a heading inside a site's open menu was outlined
      // under the menu, out of sight.
      const menu = pagePopover();
      const heading = document.createElement("h2");
      menu.append(heading);
      refs.set("sn-1", heading);
      menu.showPopover();

      fm.highlightElement("sn-1");

      expect(layer).toEqual([menu, overlay()]);
    });

    it("goes back on top, on its next draw, of a popover the page showed after it", () => {
      const btn = mkFocusable();
      refs.set("sn-1", btn);
      fm.highlightElement("sn-1");
      const menu = pagePopover();
      menu.showPopover();
      expect(layer).toEqual([overlay(), menu]);

      fm.highlightElement("sn-1");

      expect(layer).toEqual([menu, overlay()]);
    });

    it("stays out of the accessibility tree, where a popover shown is a group", () => {
      const btn = mkFocusable();
      refs.set("sn-1", btn);

      fm.highlightElement("sn-1");

      expect(overlay()!.getAttribute("aria-hidden")).toBe("true");
    });

    it("hides its own backdrop from a page's `::backdrop` rule", () => {
      const btn = mkFocusable();
      refs.set("sn-1", btn);

      fm.highlightElement("sn-1");

      expect(overlay()!.querySelector("style")!.textContent).toContain(
        "#__sn-highlight::backdrop { display: none !important; }",
      );
    });

    it("takes over an overlay an older copy of this code made, with no popover", () => {
      const old = document.createElement("div");
      old.id = "__sn-highlight";
      old.style.cssText = "position: fixed; z-index: 2147483647;";
      document.documentElement.append(old);
      const btn = mkFocusable();
      refs.set("sn-1", btn);

      fm.highlightElement("sn-1");

      expect(overlay()).toBe(old);
      expect(old.getAttribute("popover")).toBe("manual");
      expect(layer).toEqual([old]);
      // Upgraded once: a second draw adds no second backdrop rule.
      fm.highlightElement("sn-1");
      expect(old.querySelectorAll("style")).toHaveLength(1);
    });

    it("draws with the z-index alone when the top layer refuses it", () => {
      const btn = mkFocusable();
      refs.set("sn-1", btn);
      vi.spyOn(HTMLElement.prototype, "showPopover").mockImplementation(() => {
        throw new DOMException("Not fully active", "InvalidStateError");
      });

      expect(() => fm.highlightElement("sn-1")).not.toThrow();
      expect(overlay()!.style.top).toBe("10px");
    });
  });

  describe("clearHighlight", () => {
    it("REMOVES the overlay element (not just hides it)", () => {
      // Regression test: earlier implementation set display:none, which meant
      // the `focusin` listener on the page could re-activate it by just
      // flipping display back to block. Removing it forces the next highlight
      // to rebuild from scratch.
      const btn = mkFocusable();
      refs.set("sn-1", btn);

      fm.highlightElement("sn-1");
      expect(document.getElementById("__sn-highlight")).not.toBeNull();

      fm.clearHighlight();

      expect(document.getElementById("__sn-highlight")).toBeNull();
    });

    it("is idempotent — calling twice is safe", () => {
      const btn = mkFocusable();
      refs.set("sn-1", btn);

      fm.highlightElement("sn-1");
      fm.clearHighlight();
      fm.clearHighlight();

      expect(document.getElementById("__sn-highlight")).toBeNull();
    });

    it("is safe to call when no overlay exists", () => {
      expect(() => fm.clearHighlight()).not.toThrow();
    });

    it("allows the overlay to be re-created after clearing", () => {
      const btn = mkFocusable();
      refs.set("sn-1", btn);

      fm.highlightElement("sn-1");
      fm.clearHighlight();
      fm.highlightElement("sn-1");

      expect(document.getElementById("__sn-highlight")).not.toBeNull();
    });
  });

  describe("setFocus + onFocusChange", () => {
    it("notifies subscribers with the new node id", () => {
      const listener = vi.fn();
      fm.onFocusChange(listener);

      fm.setFocus("sn-1");

      expect(listener).toHaveBeenCalledWith("sn-1");
    });

    it("tracks the current node id", () => {
      expect(fm.getCurrentNodeId()).toBeNull();

      fm.setFocus("sn-42");

      expect(fm.getCurrentNodeId()).toBe("sn-42");
    });

    it("unsubscribe stops notifications", () => {
      const listener = vi.fn();
      const unsubscribe = fm.onFocusChange(listener);

      fm.setFocus("sn-1");
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      fm.setFocus("sn-2");

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("calls .focus() on the real element when focusRealElement=true", () => {
      const btn = mkFocusable();
      const focusSpy = vi.spyOn(btn, "focus");
      refs.set("sn-1", btn);

      fm.setFocus("sn-1", true);

      expect(focusSpy).toHaveBeenCalled();
    });
  });

  describe("destroy", () => {
    it("removes the overlay and clears listeners", () => {
      const btn = mkFocusable();
      refs.set("sn-1", btn);
      const listener = vi.fn();

      fm.onFocusChange(listener);
      fm.highlightElement("sn-1");

      fm.destroy();

      expect(document.getElementById("__sn-highlight")).toBeNull();

      // After destroy, subsequent setFocus calls shouldn't notify
      fm.setFocus("sn-2");
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
