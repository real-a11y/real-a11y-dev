import { describe, expect, it } from "vitest";

import {
  masksRetype,
  nativeSelectOptions,
  pickerCurrentOption,
  type NativeNode,
} from "./native-actions.js";
import {
  fieldFacets,
  fieldValueWithheld,
  pageReadValue,
  type PageFieldRead,
} from "./native-core.js";

function tree(...list: NativeNode[]): Map<string, NativeNode> {
  return new Map(list.map((n) => [n.id, n]));
}

function n(
  id: string,
  role: string,
  name: string,
  childIds: string[] = [],
  extra: Partial<NativeNode> = {},
): NativeNode {
  return { id, role, name, depth: 0, childIds, ...extra };
}

describe("nativeSelectOptions", () => {
  it("lists a real select's options, through its MenuListPopup", () => {
    const nodes = tree(
      n("sel", "combobox", "Department", ["pop"]),
      n("pop", "MenuListPopup", "", ["a", "b"]),
      n("a", "option", "All Departments"),
      n("b", "option", "Books"),
    );
    expect(
      nativeSelectOptions(nodes.get("sel")!, nodes).map((o) => o.id),
    ).toEqual(["a", "b"]);
  });

  it("includes the options inside an optgroup, in document order", () => {
    const nodes = tree(
      n("sel", "combobox", "Pet", ["pop"]),
      n("pop", "MenuListPopup", "", ["none", "grp"]),
      n("none", "option", "None"),
      n("grp", "group", "Mammals", ["cat", "dog"]),
      n("cat", "option", "Cat"),
      n("dog", "option", "Dog"),
    );
    expect(
      nativeSelectOptions(nodes.get("sel")!, nodes).map((o) => o.name),
    ).toEqual(["None", "Cat", "Dog"]);
  });

  it("is empty for a custom combobox with no MenuListPopup", () => {
    // A select-only ARIA combobox: its listbox is a sibling, not a popup
    // Chromium built for a real <select>.
    const nodes = tree(
      n("cb", "combobox", "Fruit", []),
      n("lb", "listbox", "Fruit", ["o1"]),
      n("o1", "option", "Apple"),
    );
    expect(nativeSelectOptions(nodes.get("cb")!, nodes)).toEqual([]);
  });

  it("is empty for an editable combobox and for any other role", () => {
    const nodes = tree(
      n("cb", "combobox", "Search", ["pop"], {
        states: { editable: "plaintext" },
      }),
      n("pop", "MenuListPopup", "", ["o"]),
      n("o", "option", "One"),
      n("lb", "listbox", "List", ["o"]),
    );
    expect(nativeSelectOptions(nodes.get("cb")!, nodes)).toEqual([]);
    expect(nativeSelectOptions(nodes.get("lb")!, nodes)).toEqual([]);
  });
});

describe("pickerCurrentOption", () => {
  const options = [
    n("mm", "option", "MM"),
    n("02", "option", "02", [], { states: { selected: true } }),
  ];
  const select = (extra: Partial<NativeNode>) =>
    n("sel", "combobox", "Expiry month", ["pop"], extra);

  it("marks the selected option of a select classified as not sensitive", () => {
    expect(
      pickerCurrentOption(select({ valueWithheld: false }), options)?.id,
    ).toBe("02");
  });

  it("falls back to the option named like the select's value", () => {
    const plain = [n("a", "option", "Books"), n("b", "option", "Music")];
    expect(
      pickerCurrentOption(
        select({ valueWithheld: false, value: "Music" }),
        plain,
      )?.id,
    ).toBe("b");
  });

  it("marks none for a sensitive select, empty or not", () => {
    expect(
      pickerCurrentOption(select({ valueWithheld: true }), options),
    ).toBeUndefined();
    expect(
      pickerCurrentOption(
        select({ valueWithheld: true, value: "[redacted]", redacted: true }),
        options,
      ),
    ).toBeUndefined();
  });

  it("fails closed on a select the in-page read never classified", () => {
    expect(pickerCurrentOption(select({}), options)).toBeUndefined();
  });
});

describe("masksRetype", () => {
  /** A textbox row as `NATIVE_READ` hands it to the panel: the facets and
   *  the verdict the native read builds from its element's in-page read. */
  const row = (read: PageFieldRead): NativeNode => ({
    ...n("field", "textbox", "Field"),
    ...fieldFacets("textbox", undefined, read),
    valueWithheld: fieldValueWithheld(read),
  });
  const input = (attributes: Record<string, string>, value = "") => {
    const el = document.createElement("input");
    for (const [name, v] of Object.entries(attributes))
      el.setAttribute(name, v);
    el.value = value;
    return pageReadValue.call(el);
  };

  it("masks an empty password field, which has nothing to redact", () => {
    const password = row(input({ type: "password" }));
    expect(password.redacted).toBeUndefined();
    expect(masksRetype(password)).toBe(true);
  });

  it("masks an empty card field, which Chromium doesn't mask itself", () => {
    const card = row(input({ type: "text", autocomplete: "cc-number" }));
    expect(card.redacted).toBeUndefined();
    expect(masksRetype(card)).toBe(true);
  });

  it("masks a password field that holds a value", () => {
    const password = row(input({ type: "password" }, "hunter2"));
    expect(password.redacted).toBe(true);
    expect(masksRetype(password)).toBe(true);
  });

  it("fails closed on a field the in-page read couldn't classify", () => {
    // What the read answers when the node didn't resolve or the call threw.
    expect(masksRetype(row({}))).toBe(true);
    // A row the read never asked about carries no verdict at all.
    expect(masksRetype(n("field", "textbox", "Field"))).toBe(true);
  });

  it("leaves an ordinary text field unmasked, empty or not", () => {
    expect(masksRetype(row(input({ type: "text" })))).toBe(false);
    expect(masksRetype(row(input({ type: "text" }, "Jane")))).toBe(false);
  });

  it("leaves an editor unmasked, unless a sensitive field sits inside it", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    editor.textContent = "Hello";
    expect(masksRetype(row(pageReadValue.call(editor)))).toBe(false);

    const card = document.createElement("input");
    card.setAttribute("autocomplete", "cc-number");
    editor.appendChild(card);
    expect(masksRetype(row(pageReadValue.call(editor)))).toBe(true);
  });
});
