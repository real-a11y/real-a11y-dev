import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
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
      { label: "disabled", cls: "sn-state--disabled", keyState: true },
      { label: "mixed", cls: "sn-state--mixed", keyState: true },
      { label: "collapsed", cls: "sn-state--info", keyState: true },
      { label: "required", cls: "sn-state--required", keyState: true },
      { label: "invalid=spelling", cls: "sn-state--info", keyState: true },
      { label: "hasPopup=menu", cls: "sn-state--info", keyState: false },
      { label: "level=2", cls: "sn-state--info", keyState: false },
    ]);
  });

  it("tells a key state from Chrome's other states", () => {
    const keyStates = (badges: { label: string; keyState: boolean }[]) =>
      badges.filter((b) => b.keyState).map((b) => b.label);
    expect(
      keyStates(
        nativeStateBadges(
          {
            focusable: true,
            editable: "plaintext",
            settable: true,
            disabled: true,
          },
          { autocomplete: "list" },
        ),
      ),
    ).toEqual(["disabled"]);
  });

  it("leaves a heading's level to its H badge", () => {
    expect(
      nativeStateBadges(undefined, { level: "2" }, { headingLevel: "2" }),
    ).toEqual([]);
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
      <StateBadges
        badges={nativeStateBadges({ disabled: true, busy: true }, undefined)}
      />,
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

  it("marks a row's key states, which the row shows after its label", () => {
    const badges = nativeStateBadges({ disabled: true }, undefined);
    render(<StateBadges badges={badges} />, container);
    expect(container.firstElementChild?.className).toBe("sn-state-badges");
    expect(container.firstElementChild?.hasAttribute("aria-hidden")).toBe(
      false,
    );
    // A screen reader hears them after the name instead.
    render(<StateBadges keyStates badges={badges} />, container);
    expect(container.firstElementChild?.className).toBe(
      "sn-state-badges sn-key-states",
    );
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe(
      "true",
    );
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
