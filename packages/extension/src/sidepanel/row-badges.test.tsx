import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ContentToPanel } from "../types.js";

import { App } from "./App.js";
import {
  installChromeMock,
  node,
  stubMatchMedia,
  TAB_ID,
} from "./panel-harness.js";
import {
  domStateBadges,
  EmbeddedBadge,
  nativeStateBadges,
  stateBadgeClass,
  StateBadges,
} from "./row-badges.js";

describe("stateBadgeClass", () => {
  it("colours disabled red, an on state green, mixed amber, required orange", () => {
    expect(stateBadgeClass("disabled", true)).toBe("sn-state--disabled");
    for (const key of ["checked", "pressed", "selected"]) {
      expect(stateBadgeClass(key, true)).toBe("sn-state--on");
    }
    expect(stateBadgeClass("checked", "mixed")).toBe("sn-state--mixed");
    expect(stateBadgeClass("pressed", "mixed")).toBe("sn-state--mixed");
    expect(stateBadgeClass("required", true)).toBe("sn-state--required");
  });

  it("leaves every other state grey", () => {
    for (const [key, value] of [
      ["expanded", true],
      ["expanded", false],
      ["busy", true],
      ["readonly", true],
      ["focusable", true],
      ["invalid", "true"],
      ["current", "page"],
      ["selected", false],
      ["disabled", false],
    ] as const) {
      expect(stateBadgeClass(key, value)).toBe("sn-state--info");
    }
  });
});

describe("domStateBadges", () => {
  it("shows the in-page tree's states by name, in its order", () => {
    expect(
      domStateBadges({
        current: "page",
        busy: true,
        readonly: true,
        required: true,
        expanded: false,
        selected: true,
        pressed: true,
        checked: "mixed",
        disabled: true,
        focusable: true,
      }),
    ).toEqual([
      { label: "disabled", cls: "sn-state--disabled" },
      { label: "mixed", cls: "sn-state--mixed" },
      { label: "pressed", cls: "sn-state--on" },
      { label: "selected", cls: "sn-state--on" },
      { label: "collapsed", cls: "sn-state--info" },
      { label: "required", cls: "sn-state--required" },
      { label: "readonly", cls: "sn-state--info" },
      { label: "busy", cls: "sn-state--info" },
      { label: "current: page", cls: "sn-state--info" },
    ]);
  });
});

describe("nativeStateBadges", () => {
  it("shows every state but a false one, then each property as key=value", () => {
    expect(
      nativeStateBadges(
        {
          disabled: true,
          checked: "mixed",
          expanded: false,
          required: true,
          invalid: "spelling",
          selected: false,
        },
        { hasPopup: "menu", level: "2" },
      ),
    ).toEqual([
      { label: "disabled", cls: "sn-state--disabled" },
      { label: "mixed", cls: "sn-state--mixed" },
      { label: "collapsed", cls: "sn-state--info" },
      { label: "required", cls: "sn-state--required" },
      { label: "invalid=spelling", cls: "sn-state--info" },
      { label: "hasPopup=menu", cls: "sn-state--info" },
      { label: "level=2", cls: "sn-state--info" },
    ]);
  });

  it("leaves a heading's level to its H badge", () => {
    expect(
      nativeStateBadges(undefined, { level: "2" }, { headingLevel: "2" }),
    ).toEqual([]);
  });

  it("colours a state as the in-page tree does", () => {
    const states = {
      disabled: true,
      checked: true,
      pressed: true,
      selected: true,
      required: true,
      busy: true,
    };
    const byLabel = (badges: Array<{ label: string; cls: string }>) =>
      Object.fromEntries(badges.map((b) => [b.label, b.cls]));
    expect(byLabel(nativeStateBadges(states, undefined))).toEqual(
      byLabel(domStateBadges(states)),
    );
  });
});

describe("StateBadges and EmbeddedBadge", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it("renders nothing for a row with no states", () => {
    render(<StateBadges badges={[]} />, container);
    expect(container.innerHTML).toBe("");
  });

  it("renders each badge with its colour", () => {
    render(
      <StateBadges badges={domStateBadges({ disabled: true, busy: true })} />,
      container,
    );
    expect(
      [...container.querySelectorAll(".sn-state-badge")].map((b) => [
        b.textContent,
        b.className,
      ]),
    ).toEqual([
      ["disabled", "sn-state-badge sn-state--disabled"],
      ["busy", "sn-state-badge sn-state--info"],
    ]);
  });

  it("says embedded, and what that means to a screen reader", () => {
    render(<EmbeddedBadge />, container);
    const badge = container.querySelector(".sn-iframe-badge")!;
    expect(badge.firstChild?.textContent).toBe("embedded");
    expect(badge.querySelector(".sn-sr-only")?.textContent).toBe(
      " page — nothing was read from it",
    );
  });
});

describe("the in-page tree's embedded mark", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    stubMatchMedia();
    const chromeMock = installChromeMock();
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      render(h(App, {}), container);
    });
    act(() => {
      chromeMock.emit({
        type: "ACTIVE_TAB_CHANGED",
        tabId: TAB_ID,
      } as unknown as ContentToPanel);
    });
    // One frame whose tree the service worker merged under its row, one
    // nothing was read from.
    act(() => {
      chromeMock.emit({
        type: "TREE_DATA",
        tabId: TAB_ID,
        payload: {
          nodes: [
            node("root", null, 0, "generic", "", ["read", "empty"]),
            node(
              "read",
              "root",
              1,
              "iframe",
              "Contacts",
              ["f5-root"],
              "iframe",
            ),
            node("f5-root", "read", 2, "generic", "", ["f5-save"]),
            node("f5-save", "f5-root", 3, "button", "Save"),
            node("empty", "root", 1, "iframe", "Ad", [], "iframe"),
          ],
          rootId: "root",
          pageTitle: "Frames",
          pageUrl: "https://example.test/",
        },
      } as unknown as ContentToPanel);
    });
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  function badge(nodeId: string): Element | null {
    const row = container.querySelector(`[data-node-id="${nodeId}"]`);
    if (!row) throw new Error(`no row rendered for ${nodeId}`);
    return row.querySelector(".sn-iframe-badge");
  }

  it("marks only a frame nothing was read from", () => {
    expect(badge("read")).toBeNull();
    expect(badge("empty")?.firstChild?.textContent).toBe("embedded");
  });
});
