import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { InputPanel, FOCUSABLE_SELECTOR } from "./InputPanel.js";
import type { InputPanelState } from "./InputPanel.js";

/**
 * The input panel is a dialog, and it is the one place in this extension where
 * a keyboard user is asked to type. Three things have to hold for it to be
 * usable by the assistive tech this project exists to serve:
 *
 * - the text field carries an accessible name of its own (the visible label,
 *   associated — not a placeholder, which is a weak last resort and is often
 *   absent entirely),
 * - it is announced as modal and Tab stays inside it, rather than wandering
 *   into the toolbar rendered behind it,
 * - closing it returns focus where it came from, instead of dropping focus to
 *   `<body>` and making the user Tab back from the top of the panel.
 */

const TEXT_STATE: InputPanelState = {
  type: "text",
  nodeId: "n1",
  label: "Email address",
  value: "hello",
  placeholder: "you@example.com",
};

const SELECT_STATE: InputPanelState = {
  type: "select",
  nodeId: "n2",
  label: "Country",
  value: "fr",
  options: [
    { value: "fr", label: "France", selected: true },
    { value: "de", label: "Germany", selected: false },
  ],
};

let container: HTMLDivElement;
let opener: HTMLButtonElement;
let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

beforeEach(() => {
  // jsdom does not implement scrollIntoView; stub so the select picker's
  // keep-the-active-option-visible effect can run.
  originalScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () {};

  // Stands in for whatever held focus when the panel was opened — in the panel
  // itself that is the tree container, the filtered list or the tab sequence.
  opener = document.createElement("button");
  opener.textContent = "opener";
  document.body.appendChild(opener);

  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  opener.remove();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

function open(state: InputPanelState): void {
  opener.focus();
  act(() => {
    render(
      h(InputPanel, {
        state,
        onSubmit: () => {},
        onCancel: () => {},
      }),
      container,
    );
  });
}

function close(): void {
  act(() => {
    render(null, container);
  });
}

function focusables(): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
}

function pressTab(from: HTMLElement, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  from.dispatchEvent(event);
  return event;
}

describe("InputPanel accessible name", () => {
  it("associates the visible label with the text field", () => {
    open(TEXT_STATE);

    const input = container.querySelector<HTMLInputElement>(
      "input.sn-input-panel-field",
    );
    const label = container.querySelector<HTMLLabelElement>(
      "label.sn-input-panel-label",
    );

    expect(input).not.toBeNull();
    expect(label).not.toBeNull();
    expect(input!.id).not.toBe("");
    expect(label!.getAttribute("for")).toBe(input!.id);
  });

  it("names the text field even when no placeholder is supplied", () => {
    // The GET_FIELD_STATE placeholder is the only name the field used to have,
    // and plenty of fields have none — so the name cannot depend on it.
    open({ ...TEXT_STATE, placeholder: undefined });

    const input = container.querySelector<HTMLInputElement>(
      "input.sn-input-panel-field",
    );
    const label = container.querySelector<HTMLLabelElement>(
      "label.sn-input-panel-label",
    );

    expect(input!.getAttribute("placeholder")).toBe("");
    expect(label!.getAttribute("for")).toBe(input!.id);
    expect(label!.textContent).toBe("Email address");
  });
});

describe("InputPanel dialog semantics", () => {
  it("marks the text dialog as modal", () => {
    open(TEXT_STATE);

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute("aria-modal")).toBe("true");
  });

  it("marks the select dialog as modal", () => {
    open(SELECT_STATE);

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute("aria-modal")).toBe("true");
  });
});

describe("InputPanel focus containment", () => {
  it("wraps Tab from the last control back to the first", () => {
    open(TEXT_STATE);

    const order = focusables();
    expect(order.length).toBeGreaterThan(1);
    const first = order[0];
    const last = order[order.length - 1];

    last.focus();
    const event = pressTab(last);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it("wraps Shift+Tab from the first control back to the last", () => {
    open(TEXT_STATE);

    const order = focusables();
    const first = order[0];
    const last = order[order.length - 1];

    first.focus();
    const event = pressTab(first, true);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it("pulls focus back in when Tab is pressed from outside the dialog", () => {
    // Clicking the hint line or the panel's own padding — neither focusable —
    // blurs to <body> in Chrome. Tab from there used to walk into the toolbar
    // behind a panel that still advertised itself as modal.
    open(TEXT_STATE);

    (document.activeElement as HTMLElement | null)?.blur();
    expect(container.contains(document.activeElement)).toBe(false);

    const event = pressTab(document.body);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusables()[0]);
  });

  it("keeps Tab inside the select dialog too", () => {
    open(SELECT_STATE);

    const order = focusables();
    expect(order.length).toBeGreaterThan(1);
    const first = order[0];
    const last = order[order.length - 1];

    last.focus();
    const event = pressTab(last);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });
});

describe("InputPanel focus restoration", () => {
  it("returns focus to the opener when the text dialog closes", () => {
    open(TEXT_STATE);
    expect(document.activeElement).not.toBe(opener);

    close();

    expect(document.activeElement).toBe(opener);
  });

  it("returns focus to the opener when the select dialog closes", () => {
    open(SELECT_STATE);
    expect(document.activeElement).not.toBe(opener);

    close();

    expect(document.activeElement).toBe(opener);
  });

  it("does not throw when the opener has left the DOM", () => {
    open(TEXT_STATE);
    opener.remove();

    expect(() => close()).not.toThrow();
  });
});
