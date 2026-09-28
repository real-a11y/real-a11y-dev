import type { SemanticNode } from "@real-a11y-dev/core";
import { render, h } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { ContentToPanel } from "../types.js";

import { App } from "./App.js";
import { announcedValueLabel, rawValueLabel } from "./field-value.js";
import type { ChromeMock } from "./panel-harness.js";
import { TAB_ID, installChromeMock, stubMatchMedia } from "./panel-harness.js";

/**
 * ADR-0001 in the DOM producer's panel: the A11y view shows the value a
 * screen reader announces (`a11y.value`), the DOM view the raw DOM value
 * (`dom.attributes.value`). A `<select>` reads "Spain" in one and "es" in the
 * other; a sensitive field reads `[redacted]` in both — never its contents,
 * and never a bullet per character, which is its length.
 */

interface FieldSpec {
  id: string;
  role: string;
  name: string;
  tagName: string;
  /** What core's DOM producer puts in `a11y.value`. */
  announced?: string;
  /** What it puts in `dom.attributes.value`. */
  raw?: string;
  type?: string;
  isEditable?: boolean;
  /** `dom.descendantText` — the leaf-text preview the A11y view prints. */
  text?: string;
}

function field(spec: FieldSpec): [string, SemanticNode] {
  const attributes: Record<string, string> = {};
  if (spec.type) attributes["type"] = spec.type;
  if (spec.raw !== undefined) attributes["value"] = spec.raw;
  return [
    spec.id,
    {
      id: spec.id,
      parentId: "root",
      childIds: [],
      depth: 1,
      a11y: {
        role: spec.role,
        name: spec.name,
        description: "",
        ...(spec.announced !== undefined ? { value: spec.announced } : {}),
        states: {},
        properties: {},
        isExposedToAT: true,
      },
      dom: {
        tagName: spec.tagName,
        attributes,
        textContent: spec.text ?? "",
        descendantText: spec.text ?? "",
      },
      interaction: {
        isInteractive: true,
        actions: [],
        isEditable: spec.isEditable ?? false,
        isFocusable: true,
      },
      ui: { expanded: true, selected: false, matchesFilter: true },
    } as unknown as SemanticNode,
  ];
}

const FIELDS: FieldSpec[] = [
  {
    id: "country",
    role: "combobox",
    name: "Country",
    tagName: "select",
    announced: "Spain",
    raw: "es",
  },
  {
    id: "password",
    role: "textbox",
    name: "Password",
    tagName: "input",
    type: "password",
    announced: "[redacted]",
    raw: "[redacted]",
    isEditable: true,
  },
  {
    id: "email",
    role: "textbox",
    name: "Email",
    tagName: "input",
    type: "email",
    announced: "jane@example.com",
    raw: "jane@example.com",
    isEditable: true,
  },
  // Not `isEditable`: the value used to show only on editable fields.
  {
    id: "volume",
    role: "slider",
    name: "Volume",
    tagName: "input",
    type: "range",
    announced: "Loud",
    raw: "80",
  },
  {
    id: "notes",
    role: "textbox",
    name: "Notes",
    tagName: "textarea",
    announced: "line one line two",
    raw: "line one\nline   two",
    isEditable: true,
  },
  {
    id: "empty",
    role: "textbox",
    name: "Empty",
    tagName: "input",
    isEditable: true,
  },
  // A contenteditable editor: its text is both its leaf preview and its value.
  {
    id: "editor",
    role: "textbox",
    name: "Message",
    tagName: "div",
    announced: "Hello world",
    text: "Hello world",
    isEditable: true,
  },
];

function treeData(): ContentToPanel {
  const children = FIELDS.map(field);
  const root: [string, SemanticNode] = [
    "root",
    {
      id: "root",
      parentId: null,
      childIds: children.map(([id]) => id),
      depth: 0,
      a11y: {
        role: "form",
        name: "Sign up",
        description: "",
        states: {},
        properties: {},
        isExposedToAT: true,
      },
      dom: {
        tagName: "form",
        attributes: {},
        textContent: "",
        descendantText: "",
      },
      interaction: {
        isInteractive: false,
        actions: [],
        isEditable: false,
        isFocusable: false,
      },
      ui: { expanded: true, selected: false, matchesFilter: true },
    } as unknown as SemanticNode,
  ];
  return {
    type: "TREE_DATA",
    tabId: TAB_ID,
    payload: {
      nodes: [root, ...children],
      rootId: "root",
      pageTitle: "Fields",
      pageUrl: "https://example.test/",
    },
  } as unknown as ContentToPanel;
}

describe("field values in the DOM producer's tree", () => {
  let container: HTMLDivElement;
  let chromeMock: ChromeMock;

  beforeEach(() => {
    stubMatchMedia();
    chromeMock = installChromeMock();
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
    act(() => {
      chromeMock.emit(treeData());
    });
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  /** The value text a row shows, or null when it shows none. */
  function shownValue(nodeId: string): string | null {
    const row = container.querySelector(`[data-node-id="${nodeId}"]`);
    if (!row) throw new Error(`no row rendered for ${nodeId}`);
    return row.querySelector(".sn-field-value")?.textContent ?? null;
  }

  function showView(label: "DOM" | "A11Y"): void {
    const btn = [...container.querySelectorAll("button.sn-toggle-btn")].find(
      (b) => b.textContent?.trim() === label,
    ) as HTMLButtonElement | undefined;
    if (!btn) throw new Error(`no ${label} toggle`);
    act(() => {
      btn.click();
    });
  }

  it("shows a select's announced label in the A11y view and its raw value in the DOM view", () => {
    expect(shownValue("country")).toBe('= "Spain"');
    showView("DOM");
    expect(shownValue("country")).toBe('value="es"');
  });

  it("shows a password as [redacted] in both views — never its length", () => {
    expect(shownValue("password")).toBe('= "[redacted]"');
    showView("DOM");
    expect(shownValue("password")).toBe('value="[redacted]"');
    expect(container.textContent).not.toContain("•");
  });

  it("shows a value wherever the A11y view has one, not only on editable fields", () => {
    expect(shownValue("volume")).toBe('= "Loud"');
    expect(shownValue("email")).toBe('= "jane@example.com"');
  });

  it("shows the announced value collapsed, and the raw one as written", () => {
    expect(shownValue("notes")).toBe('= "line one line two"');
    showView("DOM");
    expect(shownValue("notes")).toBe('value="line one\\nline   two"');
  });

  it("prints an editor's text once, as its value — not again as a text preview", () => {
    const row = container.querySelector('[data-node-id="editor"]')!;
    expect(shownValue("editor")).toBe('= "Hello world"');
    expect(row.textContent!.split("Hello world")).toHaveLength(2);
  });

  it("shows nothing for an empty field in either view", () => {
    expect(shownValue("empty")).toBeNull();
    showView("DOM");
    expect(shownValue("empty")).toBeNull();
  });

  it("leaves values out of the copied report, which gets posted", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied.push(text);
          return Promise.resolve();
        },
      },
    });
    const press = (label: string) => {
      const btn = [...container.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === label,
      );
      if (!btn) throw new Error(`no ${label} button`);
      act(() => {
        btn.click();
      });
    };
    press("Copy ▾");
    press("Everything");

    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain('combobox "Country"');
    for (const value of ["Spain", "es", "jane@example.com", "Loud"]) {
      expect(copied[0]).not.toContain(`"${value}"`);
    }
  });
});

describe("value labels", () => {
  it("JSON-escapes, as the serializers print a value", () => {
    expect(announcedValueLabel('say "hi"')).toBe('= "say \\"hi\\""');
    expect(rawValueLabel("a\nb")).toBe('value="a\\nb"');
  });

  it("cuts a long raw value at 240 characters with …", () => {
    const label = rawValueLabel("z".repeat(1000));
    expect(label).toBe(`value="${"z".repeat(239)}…"`);
  });
});
