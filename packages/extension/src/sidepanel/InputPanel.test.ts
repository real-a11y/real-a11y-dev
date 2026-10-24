import { render, h } from "preact";
import { act } from "preact/test-utils";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  onTestFinished,
} from "vitest";

import { FOCUSABLE_SELECTOR } from "./focus-hooks.js";
import { InputPanel, domTextInputState } from "./InputPanel.js";
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

  it("leaves focus the user moved out of it where it is", () => {
    open(TEXT_STATE);
    // Something outside it, as Settings is beside the panel's dialogs.
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    onTestFinished(() => elsewhere.remove());
    elsewhere.focus();

    close();

    expect(document.activeElement).toBe(elsewhere);
  });

  it("returns focus to the opener when nothing has it as it closes", () => {
    open(TEXT_STATE);
    // A press on something that can't take focus blurs to the body.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    close();

    expect(document.activeElement).toBe(opener);
  });

  it("does not throw when the opener has left the DOM", () => {
    open(TEXT_STATE);
    opener.remove();

    expect(() => close()).not.toThrow();
  });
});

describe("InputPanel masking", () => {
  const field = () =>
    container.querySelector<HTMLInputElement>("input.sn-input-panel-field")!;
  const typeInto = (text: string) =>
    act(() => {
      field().value = text;
      field().dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("masks what is typed when the state asks for a password field", () => {
    open({ ...TEXT_STATE, inputType: "password" });
    expect(field().type).toBe("password");
  });

  it("shows what is typed otherwise", () => {
    open(TEXT_STATE);
    expect(field().type).toBe("text");
  });

  it("opens another field's box afresh, so nothing typed carries over", () => {
    // Opening a second row's box while one is open re-renders the panel in
    // place. Reused, the editor kept the password typed for the first field,
    // unmasked now, for Enter to type into the second.
    open({
      ...TEXT_STATE,
      nodeId: "ax-dom-1",
      label: "Enter your password",
      value: "",
      inputType: "password",
      source: "native",
    });
    typeInto("hunter2");
    open({
      ...TEXT_STATE,
      nodeId: "ax-dom-2",
      label: "Full name",
      value: "Jane",
      source: "native",
    });
    expect(field().type).toBe("text");
    expect(field().value).toBe("Jane");
  });
});

/**
 * A field that takes more than one line — a textarea, an editor — gets a
 * multi-line box. The box was a one-line input, which strips line breaks from
 * what it holds: the first keystroke put the field's lines back as one, and
 * Enter typed them into the page that way.
 */
describe("InputPanel multi-line fields", () => {
  const LETTER: InputPanelState = {
    type: "text",
    nodeId: "n1",
    label: "Letter",
    value: "Dear Sam,\nThanks!",
    multiline: true,
  };

  function mount(state: InputPanelState) {
    const submitted: string[] = [];
    let cancelled = 0;
    act(() => {
      render(
        h(InputPanel, {
          state,
          onSubmit: (_id: string, value: string) => submitted.push(value),
          onCancel: () => {
            cancelled += 1;
          },
        }),
        container,
      );
    });
    const field = container.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >(".sn-input-panel-field")!;
    const key = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      act(() => {
        field.dispatchEvent(event);
      });
      return event;
    };
    return {
      field,
      submitted,
      cancelled: () => cancelled,
      // What typing at the end of the box does: the box's own text, and more.
      typeAtEnd: (text: string) =>
        act(() => {
          field.value += text;
          field.dispatchEvent(new Event("input", { bubbles: true }));
        }),
      key,
    };
  }

  it("keeps the field's line breaks through an edit", () => {
    const panel = mount(LETTER);
    expect(panel.field.localName).toBe("textarea");
    expect(panel.field.value).toBe("Dear Sam,\nThanks!");
    panel.typeAtEnd("\nJo");
    panel.key({ key: "Enter" });
    expect(panel.submitted).toEqual(["Dear Sam,\nThanks!\nJo"]);
  });

  it("starts a new line on Shift+Enter, and sets the value on Enter", () => {
    const panel = mount(LETTER);
    const shiftEnter = panel.key({ key: "Enter", shiftKey: true });
    expect(shiftEnter.defaultPrevented).toBe(false);
    expect(panel.submitted).toEqual([]);
    expect(panel.cancelled()).toBe(0);
    const enter = panel.key({ key: "Enter" });
    expect(enter.defaultPrevented).toBe(true);
    expect(panel.submitted).toEqual(["Dear Sam,\nThanks!"]);
  });

  it("says so in the box's description", () => {
    const panel = mount(LETTER);
    const hint = document.getElementById(
      panel.field.getAttribute("aria-describedby")!,
    );
    expect(hint?.textContent).toBe(
      "Enter set value · Shift+Enter new line · Esc cancel",
    );
    const label = container.querySelector("label.sn-input-panel-label");
    expect(label?.getAttribute("for")).toBe(panel.field.id);
  });

  it("keeps a one-line field's box as it was", () => {
    const panel = mount(TEXT_STATE);
    expect(panel.field.localName).toBe("input");
    expect(panel.field.hasAttribute("aria-describedby")).toBe(false);
    expect(container.querySelector(".sn-input-panel-hint")?.textContent).toBe(
      "Enter set value · Esc cancel",
    );
    panel.key({ key: "Enter", shiftKey: true });
    expect(panel.submitted).toEqual(["hello"]);
  });

  it("is multi-line whenever it holds a line break, whatever the field says", () => {
    const panel = mount({ ...LETTER, multiline: undefined });
    expect(panel.field.localName).toBe("textarea");
    expect(panel.field.value).toBe("Dear Sam,\nThanks!");
  });

  it("masks a withheld multi-line field in a one-line password box", () => {
    const panel = mount({
      ...LETTER,
      value: "",
      inputType: "password",
      blockEmptySubmit: true,
    });
    expect(panel.field.localName).toBe("input");
    expect((panel.field as HTMLInputElement).type).toBe("password");
    panel.key({ key: "Enter" });
    expect(panel.submitted).toEqual([]);
    expect(panel.cancelled()).toBe(1);
  });

  it("still cancels an untouched empty submit, and sends one typed and cleared", () => {
    const blocked = { ...LETTER, value: "", blockEmptySubmit: true };
    let panel = mount(blocked);
    expect(panel.field.localName).toBe("textarea");
    panel.key({ key: "Enter" });
    expect(panel.submitted).toEqual([]);
    expect(panel.cancelled()).toBe(1);
    close();

    panel = mount(blocked);
    panel.typeAtEnd("x");
    act(() => {
      panel.field.value = "";
      panel.field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    panel.key({ key: "Enter" });
    expect(panel.submitted).toEqual([""]);
  });

  // An in-page editor's box: multi-line, and an untouched submit types its
  // text back over formatting and images, so it cancels instead.
  it("starts a line in an editor's box without submitting, and an untouched Enter still cancels", () => {
    const editor = { ...LETTER, blockUntouchedSubmit: true };
    const panel = mount(editor);
    panel.key({ key: "Enter", shiftKey: true });
    expect(panel.submitted).toEqual([]);
    expect(panel.cancelled()).toBe(0);
    panel.key({ key: "Enter" });
    expect(panel.submitted).toEqual([]);
    expect(panel.cancelled()).toBe(1);
    close();

    const edited = mount(editor);
    edited.typeAtEnd("\nJo");
    edited.key({ key: "Enter" });
    expect(edited.submitted).toEqual(["Dear Sam,\nThanks!\nJo"]);
  });
});

/**
 * `blockEmptySubmit` opens a field empty in place of a value the panel can't
 * show (a redacted field, a native editor's content). Only the UNTOUCHED
 * submit is blocked — that one says nothing about the value — while typing
 * and then clearing the field is how a user deliberately empties it.
 */
describe("InputPanel blockEmptySubmit", () => {
  const BLOCKED: InputPanelState = {
    type: "text",
    nodeId: "n1",
    label: "Message",
    value: "",
    blockEmptySubmit: true,
  };

  function mount(state: InputPanelState) {
    const submitted: string[] = [];
    let cancelled = 0;
    act(() => {
      render(
        h(InputPanel, {
          state,
          onSubmit: (_id: string, value: string) => submitted.push(value),
          onCancel: () => {
            cancelled += 1;
          },
        }),
        container,
      );
    });
    const input = container.querySelector<HTMLInputElement>(
      "input.sn-input-panel-field",
    )!;
    const type = (text: string) =>
      act(() => {
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    const enter = () =>
      act(() => {
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
    const setValueButton = () =>
      [...container.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Set value",
      )!;
    return {
      submitted,
      cancelled: () => cancelled,
      type,
      enter,
      setValueButton,
    };
  }

  it("cancels an untouched empty submit instead of submitting it", () => {
    const panel = mount(BLOCKED);
    panel.enter();
    act(() => panel.setValueButton().click());
    expect(panel.submitted).toEqual([]);
    expect(panel.cancelled()).toBe(2);
  });

  it("submits an empty value the user typed and then cleared — a deliberate clear", () => {
    const panel = mount(BLOCKED);
    panel.type("x");
    panel.type("");
    panel.enter();
    expect(panel.submitted).toEqual([""]);
    expect(panel.cancelled()).toBe(0);
  });

  it("submits a typed replacement normally", () => {
    const panel = mount(BLOCKED);
    panel.type("new text");
    act(() => panel.setValueButton().click());
    expect(panel.submitted).toEqual(["new text"]);
  });

  it("leaves an unflagged field's empty submit alone", () => {
    const panel = mount({ ...BLOCKED, blockEmptySubmit: undefined });
    panel.enter();
    expect(panel.submitted).toEqual([""]);
  });

  /**
   * `blockUntouchedSubmit` is for a box that holds less than its field: an
   * in-page editor's box opens on its text, but a retype replaces its images,
   * controls and formatting too. Any submit with no edit cancels, prefilled
   * or not; any edit submits, as above.
   */
  describe("blockUntouchedSubmit", () => {
    const PREFILLED: InputPanelState = {
      type: "text",
      nodeId: "n1",
      label: "Greeting",
      value: "Hello",
      blockUntouchedSubmit: true,
    };

    it("cancels an untouched submit, though the box holds text", () => {
      const panel = mount(PREFILLED);
      panel.enter();
      act(() => panel.setValueButton().click());
      expect(panel.submitted).toEqual([]);
      expect(panel.cancelled()).toBe(2);
    });

    it("cancels an untouched submit of an empty box", () => {
      const panel = mount({ ...PREFILLED, value: "" });
      panel.enter();
      expect(panel.submitted).toEqual([]);
      expect(panel.cancelled()).toBe(1);
    });

    it("submits an edit, an emptied box included", () => {
      const panel = mount(PREFILLED);
      panel.type("Goodbye");
      panel.enter();
      panel.type("");
      panel.enter();
      expect(panel.submitted).toEqual(["Goodbye", ""]);
      expect(panel.cancelled()).toBe(0);
    });
  });
});

describe("InputPanel select picker selection state", () => {
  function selectedLabels(): string[] {
    return Array.from(
      container.querySelectorAll<HTMLElement>(
        '[role="option"][aria-selected="true"]',
      ),
    ).map((o) => o.textContent!.replace(/^[●○]/, ""));
  }

  function activeLabel(): string | undefined {
    const list = container.querySelector('[role="listbox"]')!;
    const id = list.getAttribute("aria-activedescendant");
    return id
      ? container.querySelector(`#${id}`)!.textContent!.replace(/^[●○]/, "")
      : undefined;
  }

  it("announces the field's current option as selected, and starts on it", () => {
    open(SELECT_STATE);
    expect(selectedLabels()).toEqual(["France"]);
    expect(activeLabel()).toBe("France");
  });

  it("moving the cursor doesn't announce another option as chosen", () => {
    open(SELECT_STATE);
    const list = container.querySelector('[role="listbox"]')!;
    act(() => {
      list.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(activeLabel()).toBe("Germany");
    expect(selectedLabels()).toEqual(["France"]);
  });

  it("starts another select's picker on that select's own option", () => {
    // Opening a second select's picker while one is open re-renders the panel
    // in place. Reused, the picker kept the first one's place, for Enter to
    // choose that position in the second list.
    open(SELECT_STATE);
    act(() => {
      container
        .querySelector('[role="listbox"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
    });
    expect(activeLabel()).toBe("Germany");
    open({
      ...SELECT_STATE,
      nodeId: "n3",
      label: "Currency",
      value: "eur",
      options: [
        { value: "eur", label: "Euro", selected: true },
        { value: "usd", label: "Dollar", selected: false },
      ],
    });
    expect(activeLabel()).toBe("Euro");
  });

  it("announces no option as selected when the current one is withheld", () => {
    // A sensitive select reports none: the cursor starts on the first
    // option, but nothing may claim to be the field's value.
    open({
      ...SELECT_STATE,
      value: "",
      options: SELECT_STATE.options!.map((o) => ({ ...o, selected: false })),
    });
    expect(activeLabel()).toBe("France");
    expect(selectedLabels()).toEqual([]);
  });
});

describe("InputPanel select picker disabled options", () => {
  const STATE: InputPanelState = {
    ...SELECT_STATE,
    options: [
      { value: "fr", label: "France", selected: true },
      { value: "de", label: "Germany", selected: false, disabled: true },
    ],
  };

  function mountWith(onSubmit: (value: string) => void): void {
    opener.focus();
    act(() => {
      render(
        h(InputPanel, { state: STATE, onSubmit, onCancel: () => {} }),
        container,
      );
    });
  }

  it("lists a disabled option as disabled, and never submits it", () => {
    const submitted: string[] = [];
    mountWith((v) => submitted.push(v));
    const germany =
      container.querySelectorAll<HTMLElement>('[role="option"]')[1]!;
    expect(germany.getAttribute("aria-disabled")).toBe("true");

    act(() => germany.click());
    const list = container.querySelector('[role="listbox"]')!;
    act(() => {
      list.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(submitted).toEqual([]);
  });
});

/**
 * The edit box a DOM tree row opens. A field whose value is withheld arrives
 * without it, and its box has to hide what is typed whatever the field's own
 * type says: a card or one-time-code field is a text or tel input. Nor may an
 * untouched Enter type "" over the value the box couldn't show.
 */
describe("domTextInputState", () => {
  const withheld = (type: string) =>
    domTextInputState("n1", "Card number", {
      success: true,
      type,
      value: "",
      placeholder: "",
      valueWithheld: true,
    });

  function mount(state: InputPanelState) {
    const submitted: string[] = [];
    let cancelled = 0;
    act(() => {
      render(
        h(InputPanel, {
          state,
          onSubmit: (_id: string, value: string) => submitted.push(value),
          onCancel: () => {
            cancelled += 1;
          },
        }),
        container,
      );
    });
    const input = container.querySelector<HTMLInputElement>(
      "input.sn-input-panel-field",
    )!;
    return {
      input,
      submitted,
      cancelled: () => cancelled,
      type: (text: string) =>
        act(() => {
          input.value = text;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }),
      enter: () =>
        act(() => {
          input.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
          );
        }),
    };
  }

  it("masks a withheld field's box whatever the field's own type", () => {
    for (const type of ["text", "tel", "textarea", "password"]) {
      const panel = mount(withheld(type));
      expect(panel.input.type, type).toBe("password");
      expect(panel.input.value, type).toBe("");
      close();
    }
  });

  it("cancels an untouched Enter on a withheld field instead of blanking it", () => {
    const panel = mount(withheld("password"));
    panel.enter();
    expect(panel.submitted).toEqual([]);
    expect(panel.cancelled()).toBe(1);
  });

  it("types what the user enters into a withheld field", () => {
    const panel = mount(withheld("text"));
    panel.type("4111111111111111");
    panel.enter();
    expect(panel.submitted).toEqual(["4111111111111111"]);
  });

  it("never prefills a withheld field, even from a reply that held a value", () => {
    const state = domTextInputState("n1", "Password", {
      success: true,
      type: "password",
      value: "hunter2",
      valueWithheld: true,
    });
    expect(state.value).toBe("");
  });

  // A one-line box strips line breaks: the first keystroke put a textarea's
  // lines, or an editor's, back as one, and Enter typed them that way.
  it("opens a multi-line field's box on its lines, and an edit keeps them", () => {
    for (const [type, value] of [
      ["textarea", "Dear Sam,\nThanks!"],
      ["text", "Milk\nEggs"],
    ]) {
      const panel = mount(
        domTextInputState("n1", "Letter", {
          success: true,
          type,
          multiline: true,
          value,
          placeholder: "",
        }),
      );
      const box = container.querySelector<HTMLTextAreaElement>(
        "textarea.sn-input-panel-field",
      );
      expect(box?.value, type).toBe(value);
      act(() => {
        box!.value += "\nJo";
        box!.dispatchEvent(new Event("input", { bubbles: true }));
      });
      act(() => {
        box!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
      expect(panel.submitted, type).toEqual([`${value}\nJo`]);
      close();
    }
  });

  it("masks a withheld multi-line field as any other", () => {
    const panel = mount(
      domTextInputState("n1", "Recovery codes", {
        success: true,
        type: "textarea",
        multiline: true,
        value: "",
        placeholder: "",
        valueWithheld: true,
      }),
    );
    expect(panel.input.type).toBe("password");
    expect(panel.input.value).toBe("");
    panel.enter();
    expect(panel.submitted).toEqual([]);
  });

  it("leaves an ordinary field's box as it was: prefilled and unmasked", () => {
    const state = domTextInputState("n1", "Email", {
      success: true,
      type: "email",
      value: "a@b.com",
      placeholder: "you@example.com",
    });
    expect(state).toEqual({
      type: "text",
      nodeId: "n1",
      label: "Email",
      value: "a@b.com",
      inputType: "email",
      placeholder: "you@example.com",
    });
    const panel = mount(state);
    expect(panel.input.type).toBe("text");
    panel.enter();
    expect(panel.submitted).toEqual(["a@b.com"]);
  });

  // An editor's box opens on its text alone, and a retype replaces everything
  // in it with what the box sends. An untouched Enter typed "Hello" back over
  // `Hello <img>`, losing the image, and "" over an editor holding only an
  // image, a control or a rule, losing it.
  const editor = (value: string) =>
    domTextInputState("n1", "Greeting", {
      success: true,
      type: "text",
      value,
      placeholder: "",
      editor: true,
    });

  it("opens an editor's box on its text, and an untouched Enter changes nothing", () => {
    for (const value of ["Hello", ""]) {
      const panel = mount(editor(value));
      expect(panel.input.type, value).toBe("text");
      expect(panel.input.value, value).toBe(value);
      panel.enter();
      expect(panel.submitted, value).toEqual([]);
      expect(panel.cancelled(), value).toBe(1);
      close();
    }
  });

  it("types an edit into an editor, and empties one the user cleared", () => {
    let panel = mount(editor("Hello"));
    panel.type("Goodbye");
    panel.enter();
    expect(panel.submitted).toEqual(["Goodbye"]);
    close();

    panel = mount(editor(""));
    panel.type("x");
    panel.type("");
    panel.enter();
    expect(panel.submitted).toEqual([""]);
  });

  it("still masks an editor holding a sensitive field, and opens it empty", () => {
    const state = domTextInputState("n1", "Payment note", {
      success: true,
      type: "text",
      value: "",
      placeholder: "",
      valueWithheld: true,
      editor: true,
    });
    const panel = mount(state);
    expect(panel.input.type).toBe("password");
    expect(panel.input.value).toBe("");
    panel.enter();
    expect(panel.submitted).toEqual([]);
    panel.type("4111111111111111");
    panel.enter();
    expect(panel.submitted).toEqual(["4111111111111111"]);
  });
});
