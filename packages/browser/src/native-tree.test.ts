// Unit tests for the native producer's pure assembly (`buildNativeTree`) and
// its redaction gate (`allowlistAttributes`), run against REAL recorded
// `Accessibility.getFullAXTree` + `DOM.getDocument` payloads:
//   - __fixtures__/native-ax-payload.json (Chromium 141) — a `<video>` with
//     UA-shadow controls and email/password fields holding real values;
//   - __fixtures__/native-ax-values.json (Chromium 151) — one of each kind of
//     field ADR-0001 announces a value for, plus sensitive ones placed where
//     Chromium names a container from them (a table cell);
//   - __fixtures__/native-ax-editor{,-hosts}.json (Chromium 151) — rich-text
//     editors, for the strict `redactInput` mode.
// No browser needed at test time; the recording IS the browser's output.

import { normalizeNativeAX } from "@real-a11y-dev/core";
import { serializeTree } from "@real-a11y-dev/serialize";
import { describe, expect, it } from "vitest";

import hostsPayload from "./__fixtures__/native-ax-editor-hosts.json";
import editorPayload from "./__fixtures__/native-ax-editor.json";
import payload from "./__fixtures__/native-ax-payload.json";
import valuesPayload from "./__fixtures__/native-ax-values.json";
import {
  allowlistAttributes,
  buildNativeTree,
  nativeAXView,
  type NativeDomInfo,
} from "./native-tree.js";

const EMAIL_SECRET = "secret-user@example.com";
const PASSWORD_SECRET = "hunter2-SECRET";

type RawNodes = Parameters<typeof buildNativeTree>[0];

/**
 * A recorded `enrich` block as the live DOM walk would have produced it: the
 * tag, the allowlisted attributes, and the `aria-valuetext` it reads aside.
 */
function enrichmentOf(
  enrich: Record<string, { tagName: string; attributes: string[] }>,
): Map<number, NativeDomInfo> {
  return new Map(
    Object.entries(enrich).map(([backendId, e]) => {
      const at = e.attributes.indexOf("aria-valuetext");
      return [
        Number(backendId),
        {
          tagName: e.tagName.toLowerCase(),
          attributes: allowlistAttributes(e.attributes),
          ...(at >= 0 && at % 2 === 0
            ? { ariaValueText: e.attributes[at + 1] }
            : {}),
        },
      ];
    }),
  );
}

/** A DOM record for a hand-built raw node. */
const domOf = (
  tagName: string,
  attributes: Record<string, string> = {},
): NativeDomInfo => ({ tagName, attributes });

const rawNodes = payload.nodes as RawNodes;
const enrichment = enrichmentOf(payload.enrich);

function build(options: { redactInput?: boolean } = {}) {
  return buildNativeTree(rawNodes, enrichment, payload.chrome, options);
}

const nodesOf = (tree: ReturnType<typeof buildNativeTree>) => [
  ...tree.nodes.values(),
];

describe("allowlistAttributes (R1 redaction gate)", () => {
  it("drops value and any non-allowlisted attribute", () => {
    const attrs = allowlistAttributes([
      "type",
      "email",
      "value",
      EMAIL_SECRET,
      "id",
      "field",
      "data-secret",
      "leak",
    ]);
    expect(attrs).toEqual({ type: "email", id: "field" });
    expect(
      allowlistAttributes([
        "aria-label",
        "Email",
        "aria-describedby",
        "hint",
        "value",
        EMAIL_SECRET,
      ]),
    ).toEqual({ "aria-label": "Email", "aria-describedby": "hint" });
    expect(Object.values(attrs)).not.toContain(EMAIL_SECRET);
  });
});

describe("buildNativeTree — provenance + shape", () => {
  it("stamps source.producer = native with the chrome version", () => {
    const tree = build();
    expect(tree.source).toEqual({ producer: "native", chrome: payload.chrome });
  });

  it("produces a rooted, parent-linked SemanticNode tree", () => {
    const tree = build();
    expect(tree.rootId).toBeTruthy();
    const root = tree.nodes.get(tree.rootId);
    expect(root?.parentId).toBeNull();
    for (const [id, node] of tree.nodes) {
      if (id === tree.rootId) continue;
      // every non-root is reachable via a real parent
      expect(node.parentId).not.toBeNull();
      expect(tree.nodes.has(node.parentId as string)).toBe(true);
    }
  });

  it("carries a11y with computed states/properties, and dom only when DOM-backed", () => {
    const tree = build();
    const toggle = [...tree.nodes.values()].find(
      (n) => n.a11y.role === "button" && n.a11y.name === "Toggle",
    );
    expect(toggle).toBeDefined();
    expect(toggle!.a11y.states.pressed).toBe(true); // aria-pressed="true"
    expect(toggle!.dom?.tagName).toBe("button"); // DOM-backed → dom facet
  });

  it("is read-only: no interaction or ui facet on any node", () => {
    const tree = build();
    for (const node of tree.nodes.values()) {
      expect(node.interaction).toBeUndefined();
      expect(node.ui).toBeUndefined();
    }
  });
});

describe("buildNativeTree — the forcing function (UA-shadow media controls)", () => {
  it("exposes the <video>'s user-agent controls as child nodes", () => {
    const printed = serializeTree(build(), { includeGeneric: true });
    expect(printed).toMatch(/^\s*video /m);
    expect(printed).toContain('button "play"');
    expect(printed).toMatch(
      /slider "(video time scrubber|audio time scrubber)"/,
    );
  });
});

describe("buildNativeTree — field values on the recorded payload (ADR-0001)", () => {
  const field = (tree: ReturnType<typeof buildNativeTree>, name: RegExp) =>
    nodesOf(tree).find(
      (n) => n.a11y.role === "textbox" && name.test(n.a11y.name),
    );

  it("shows a text field's value as a11y.value — and only there", () => {
    const email = field(build(), /email/i);
    expect(email).toBeDefined();
    // Page content, the way a screen reader announces it.
    expect(email!.a11y.value).toBe(EMAIL_SECRET);
    // Never as the name, and never on the dom facet.
    expect(email!.a11y.name).toBe("Email");
    expect(email!.dom?.attributes.value).toBeUndefined();
  });

  it("withholds a password as [redacted] — never Chromium's bullets, which give away its length", () => {
    const tree = build();
    const password = field(tree, /password/i);
    expect(password!.a11y.value).toBe("[redacted]");
    const blob = JSON.stringify(nodesOf(tree));
    expect(blob).not.toContain("•");
    expect(blob).not.toContain(PASSWORD_SECRET);
  });

  it("prints values only when the serializer is asked to", () => {
    const tree = build();
    expect(serializeTree(tree)).not.toContain(EMAIL_SECRET);
    const withValues = serializeTree(tree, { values: true });
    expect(withValues).toContain(`textbox "Email" = "${EMAIL_SECRET}"`);
    expect(withValues).toContain('textbox "Password" = "[redacted]"');
  });

  it("reads a UA-shadow range control's aria-valuetext, from the DOM walk", () => {
    const scrubber = nodesOf(build()).find(
      (n) => n.a11y.role === "slider" && /time scrubber/.test(n.a11y.name),
    );
    expect(scrubber?.a11y.value).toBe("elapsed time: 0:00");
    // A value has one home; the bounds stay properties.
    expect(scrubber?.a11y.properties.valuetext).toBeUndefined();
    expect(scrubber?.a11y.properties.valuemax).toBe("100");
  });

  it("strict mode (redactInput) withholds every value, sensitive or not", () => {
    const tree = build({ redactInput: true });
    for (const node of nodesOf(tree)) expect(node.a11y.value).toBeUndefined();
    const blob = JSON.stringify(nodesOf(tree));
    expect(blob).not.toContain(EMAIL_SECRET);
    expect(blob).not.toContain(PASSWORD_SECRET);
    expect(blob).not.toContain("elapsed time");
    // The fields are still there: only what they hold is gone.
    expect(field(tree, /email/i)?.a11y.name).toBe("Email");
  });

  it("the recorded raw payload DID contain the secrets (guards the test)", () => {
    // If the fixture ever stops carrying real values, the tests above are
    // vacuous — pin that the classification is doing real work.
    expect(JSON.stringify(payload)).toContain(EMAIL_SECRET);
    expect(JSON.stringify(payload.nodes)).toContain("••••");
  });
});

describe("buildNativeTree — what a screen reader announces, per kind of field (Chromium 151)", () => {
  // __fixtures__/native-ax-values.json; the page is in its `html` key.
  const valuesRaw = valuesPayload.nodes as RawNodes;
  const valuesEnrichment = enrichmentOf(valuesPayload.enrich);
  const buildValues = (options: { redactInput?: boolean } = {}) =>
    buildNativeTree(valuesRaw, valuesEnrichment, valuesPayload.chrome, options);
  const valueOf = (role: string, name: string) =>
    nodesOf(buildValues()).find(
      (n) => n.a11y.role === role && n.a11y.name === name,
    )?.a11y.value;

  it("the recording carries the plaintext of every sensitive field (guards the tests)", () => {
    // Chromium masks a password, but not a card number on a text input, nor
    // the month and year inside a card-expiry input.
    const raw = JSON.stringify(valuesPayload.nodes);
    expect(raw).toContain("SENSITIVE-card");
    expect(raw).toContain("SENSITIVE-cell-card");
    expect(raw).toContain("2031-04");
    expect(raw).toContain("••••");
  });

  it.each([
    ["textbox", "Email", "VALUE-email@example.com"],
    // A <select> announces the selected option's text, not its value.
    ["combobox", "Country", "France"],
    ["slider", "Volume", "3"],
    // aria-valuetext beats the number; Chromium 151 doesn't report it.
    ["slider", "Rating", "four of five stars"],
    // 0.6 arrives as the float 0.6000000238418579.
    ["meter", "", "0.6"],
    // Whitespace collapses, as in every value.
    ["textbox", "Notes", "line one line two"],
    ["button", "Attachment", "report.pdf"],
    // A role-less contenteditable is a field: kept, and its text is its value.
    ["generic", "", "VALUE-plain-editor"],
    ["textbox", "Quantity", "3"],
  ])("%s %j = %j", (role, name, value) => {
    expect(valueOf(role, name)).toBe(value);
  });

  it.each([
    ["checkbox", "Agree"], // its state says it
    ["searchbox", "Search"], // empty is no value
  ])("%s %j has no value", (role, name) => {
    const node = nodesOf(buildValues()).find(
      (n) => n.a11y.role === role && n.a11y.name === name,
    );
    expect(node).toBeDefined();
    expect(node!.a11y.value).toBeUndefined();
  });

  it.each([
    ["textbox", "Password"],
    ["textbox", "Card number"], // autocomplete="cc-number"
    ["DateTime", "Expiry"], // autocomplete="cc-exp"
    // …and the month and year INSIDE the expiry input: UA-shadow nodes whose
    // own <div> says nothing, classified by the field around them.
    ["spinbutton", "Month Month"],
    ["spinbutton", "Year Year"],
    ["textbox", "Card in table"],
    ["textbox", "PIN"],
  ])("sensitive %s %j reads [redacted]", (role, name) => {
    expect(valueOf(role, name)).toBe("[redacted]");
  });

  it("keeps a sensitive value out of a container Chromium named from its contents", () => {
    // Chromium names `<td><input autocomplete="cc-number"></td>` after the
    // card number, and a cell around a password after its bullets.
    const cells = nodesOf(buildValues()).filter(
      (n) => n.a11y.role === "LayoutTableCell",
    );
    expect(cells.map((c) => c.a11y.name)).toEqual([
      "Card", // a cell that merely sits beside one keeps its text
      "[redacted]",
      "[redacted]",
    ]);
    // A non-sensitive embedded value is page content, like any other.
    expect(
      nodesOf(buildValues()).find(
        (n) => n.a11y.role === "button" && n.a11y.name.startsWith("Buy"),
      )?.a11y.name,
    ).toBe("Buy 3 items");
  });

  it("no sensitive value, mask or part of one reaches any facet of any node", () => {
    for (const options of [{}, { redactInput: true }]) {
      const blob = JSON.stringify(nodesOf(buildValues(options)));
      expect(blob).not.toContain("SENSITIVE");
      expect(blob).not.toContain("2031");
      expect(blob).not.toContain("•");
    }
  });

  it("serializes the way a screen reader reads the form", () => {
    const printed = serializeTree(buildValues(), { values: true });
    expect(printed).toContain('textbox "Email" = "VALUE-email@example.com"');
    expect(printed).toContain('combobox "Country" = "France"');
    expect(printed).toContain('textbox "Password" = "[redacted]"');
    expect(printed).toContain('generic = "VALUE-plain-editor"');
  });

  it("strict mode (redactInput) prints the same form with no values at all", () => {
    const tree = buildValues({ redactInput: true });
    for (const node of nodesOf(tree)) expect(node.a11y.value).toBeUndefined();
    const printed = serializeTree(tree, { values: true });
    expect(printed).toContain('textbox "Email"\n');
    expect(printed).not.toContain(" = ");
    expect(printed).not.toContain("VALUE-");
  });
});

describe("buildNativeTree — value edge cases", () => {
  const withValue = (
    role: string,
    value: unknown,
    extra: Record<string, unknown> = {},
  ) =>
    [
      { nodeId: "1", childIds: ["2"], role: { value: "RootWebArea" } },
      {
        nodeId: "2",
        parentId: "1",
        role: { value: role },
        name: { value: "Field" },
        value: { value },
        backendDOMNodeId: 70,
        ...extra,
      },
    ] as RawNodes;
  const valueOf = (
    raw: RawNodes,
    dom: NativeDomInfo | null = domOf("input", { type: "text" }),
  ) =>
    buildNativeTree(raw, dom ? new Map([[70, dom]]) : new Map()).nodes.get(
      "ax-dom-70",
    )?.a11y.value;

  it("caps a long value at 240 characters with …", () => {
    const long = "x".repeat(300);
    const value = valueOf(withValue("textbox", long));
    expect(value).toHaveLength(240);
    expect(value?.endsWith("…")).toBe(true);
  });

  it("withholds a value it cannot classify: a DOM-backed node the DOM walk never saw", () => {
    expect(valueOf(withValue("textbox", "hello"), null)).toBe("[redacted]");
  });

  it("withholds Chromium's password mask even when the markup is unknown", () => {
    expect(valueOf(withValue("textbox", "•••••"), domOf("div"))).toBe(
      "[redacted]",
    );
  });

  it("classifies by type and by every autocomplete token, not just the first", () => {
    expect(
      valueOf(withValue("textbox", "x"), domOf("input", { type: "PASSWORD" })),
    ).toBe("[redacted]");
    expect(
      valueOf(
        withValue("textbox", "x"),
        domOf("input", { autocomplete: "section-pay billing cc-csc" }),
      ),
    ).toBe("[redacted]");
    // `autocomplete="off"` means "don't autofill", not "secret".
    expect(
      valueOf(
        withValue("textbox", "x"),
        domOf("input", { autocomplete: "off" }),
      ),
    ).toBe("x");
  });

  it("prints a number the way the page wrote it, a zero included", () => {
    expect(valueOf(withValue("progressbar", 0.30000001192092896))).toBe("0.3");
    expect(valueOf(withValue("slider", 0))).toBe("0");
    expect(valueOf(withValue("spinbutton", 2031))).toBe("2031");
  });

  it("has no value for an empty field, or a checkbox", () => {
    expect(valueOf(withValue("textbox", "   "))).toBeUndefined();
    expect(valueOf(withValue("checkbox", "true"))).toBeUndefined();
  });

  it("withholds the value of a node that CONTAINS a sensitive field", () => {
    // An editor or an ARIA combobox around a credential field may build its
    // own value from it.
    const raw = [
      { nodeId: "1", childIds: ["2"], role: { value: "RootWebArea" } },
      {
        nodeId: "2",
        parentId: "1",
        childIds: ["3"],
        role: { value: "combobox" },
        name: { value: "Card" },
        value: { value: "4111 1111" },
        backendDOMNodeId: 80,
      },
      {
        nodeId: "3",
        parentId: "2",
        role: { value: "textbox" },
        name: { value: "Card" },
        value: { value: "4111 1111" },
        backendDOMNodeId: 81,
      },
    ] as RawNodes;
    const tree = buildNativeTree(
      raw,
      new Map([
        [80, domOf("div", { role: "combobox" })],
        [81, domOf("input", { autocomplete: "cc-number" })],
      ]),
    );
    expect(tree.nodes.get("ax-dom-80")?.a11y.value).toBe("[redacted]");
    expect(tree.nodes.get("ax-dom-81")?.a11y.value).toBe("[redacted]");
    expect(JSON.stringify(nodesOf(tree))).not.toContain("4111");
  });

  it("keeps a container's name that came from its markup, not its contents", () => {
    const raw = [
      { nodeId: "1", childIds: ["2"], role: { value: "RootWebArea" } },
      {
        nodeId: "2",
        parentId: "1",
        childIds: ["3"],
        role: { value: "group" },
        name: {
          value: "Payment",
          sources: [{ type: "relatedElement", value: { value: "Payment" } }],
        },
        backendDOMNodeId: 90,
      },
      {
        nodeId: "3",
        parentId: "2",
        role: { value: "textbox" },
        name: { value: "Card" },
        backendDOMNodeId: 91,
      },
    ] as RawNodes;
    const tree = buildNativeTree(
      raw,
      new Map([
        [90, domOf("fieldset")],
        [91, domOf("input", { autocomplete: "cc-number" })],
      ]),
    );
    expect(tree.nodes.get("ax-dom-90")?.a11y.name).toBe("Payment");
  });
});

describe("buildNativeTree — R1: unlabeled field value must not leak via the name", () => {
  // The fixture's inputs are all labeled, so an UNLABELED control (where
  // Chromium emits the typed value as a StaticText descendant) is not
  // exercised there. This builds that exact shape explicitly.
  const TYPED_SECRET = "typed-SECRET-value";
  const raw = [
    { nodeId: "1", childIds: ["2"], role: { value: "RootWebArea" } },
    {
      nodeId: "2",
      parentId: "1",
      childIds: ["3", "6"],
      role: { value: "main" },
    },
    // Unlabeled textbox: no own name, has a value, value surfaced as a
    // StaticText descendant — the leak vector.
    {
      nodeId: "3",
      parentId: "2",
      childIds: ["4"],
      role: { value: "textbox" },
      name: { value: "" },
      value: { value: TYPED_SECRET },
      backendDOMNodeId: 100,
    },
    { nodeId: "4", parentId: "3", childIds: ["5"], role: { value: "generic" } },
    {
      nodeId: "5",
      parentId: "4",
      role: { value: "StaticText" },
      name: { value: TYPED_SECRET },
    },
    // Labeled textbox: own name present → promotion never fires, name kept.
    {
      nodeId: "6",
      parentId: "2",
      role: { value: "textbox" },
      name: { value: "Email" },
      value: { value: "someone@example.com" },
      backendDOMNodeId: 200,
    },
  ] as Parameters<typeof buildNativeTree>[0];

  it("core never promotes the value: a textbox is named by its author only", () => {
    // The producer takes names from core as-is, so this is the gate. The next
    // describe covers a role core does name from its text.
    const textbox = normalizeNativeAX(raw).find((n) => n.id === "ax-dom-100");
    expect(textbox?.role).toBe("textbox");
    expect(textbox?.name).toBe("");
  });

  it("keeps the value out of an unlabeled control's name", () => {
    const tree = buildNativeTree(raw);
    const unlabeled = tree.nodes.get("ax-dom-100");
    expect(unlabeled?.a11y.role).toBe("textbox");
    expect(unlabeled?.a11y.name).toBe(""); // not promoted
    expect(serializeTree(tree, { includeGeneric: true })).not.toContain(
      TYPED_SECRET,
    );
  });

  it("puts the value in a11y.value instead — once the DOM walk has classified the field", () => {
    const enriched = buildNativeTree(
      raw,
      new Map([
        [100, domOf("input", { type: "text" })],
        [200, domOf("input", { type: "email" })],
      ]),
    );
    expect(enriched.nodes.get("ax-dom-100")?.a11y).toMatchObject({
      name: "",
      value: TYPED_SECRET,
    });
    expect(serializeTree(enriched, { values: true })).toContain(
      `textbox = "${TYPED_SECRET}"`,
    );
    // With no DOM record there is nothing to classify it by: withheld.
    expect(buildNativeTree(raw).nodes.get("ax-dom-100")?.a11y.value).toBe(
      "[redacted]",
    );
  });

  it("keeps an authored (labeled) control's name", () => {
    const labeled = buildNativeTree(raw).nodes.get("ax-dom-200");
    expect(labeled?.a11y.name).toBe("Email");
  });

  it("applies the same redaction to nativeAXView (nativeAX())", () => {
    const { tree, pairs } = nativeAXView(raw);
    expect(tree).toBe('main\n  textbox\n  textbox "Email"');
    expect(pairs).toEqual(["main", "textbox", 'textbox "Email"']);
    expect(JSON.stringify(pairs)).not.toContain(TYPED_SECRET);
  });
});

describe("buildNativeTree — R1: a value never becomes a name, for a role core otherwise names from its text", () => {
  // Chromium 151's shape for `<div role="application" contenteditable>typed
  // secret</div>`: the typed text is the node's AX value AND its StaticText
  // child. `application` is not one of the author-named fields core refuses to
  // name from text — the AX value is what keeps the text out of its name.
  const TYPED_SECRET = "typed-SECRET-value";
  const raw = [
    { nodeId: "1", childIds: ["2"], role: { value: "RootWebArea" } },
    {
      nodeId: "2",
      parentId: "1",
      childIds: ["3"],
      role: { value: "application" },
      name: { value: "" },
      value: { value: TYPED_SECRET },
      backendDOMNodeId: 400,
    },
    {
      nodeId: "3",
      parentId: "2",
      role: { value: "StaticText" },
      name: { value: TYPED_SECRET },
    },
  ] as Parameters<typeof buildNativeTree>[0];

  it("sanity: without the value, core would name it from that same text (the vector)", () => {
    // Proves the vector is real, so the test below can never pass vacuously:
    // it is the value, not the role or the shape, that keeps the text out.
    const withoutValue = raw.map(({ value: _value, ...node }) => node);
    const promoted = normalizeNativeAX(withoutValue).find(
      (n) => n.id === "ax-dom-400",
    );
    expect(promoted?.name).toBe(TYPED_SECRET);
  });

  it("keeps it out of buildNativeTree and nativeAXView", () => {
    const tree = buildNativeTree(raw);
    expect(tree.nodes.get("ax-dom-400")?.a11y.name).toBe("");
    expect(serializeTree(tree, { includeGeneric: true })).not.toContain(
      TYPED_SECRET,
    );
    expect(nativeAXView(raw).tree).toBe("application");
  });
});

describe("buildNativeTree — a scrollbar is never named from its text, value or not", () => {
  // Chromium always reports a scrollbar value, which keeps its fallback text
  // out on its own. This pins the payload without one: the producer's former
  // strip covered `scrollbar` by role, and core's table now does.
  const raw = [
    { nodeId: "1", childIds: ["2"], role: { value: "RootWebArea" } },
    {
      nodeId: "2",
      parentId: "1",
      childIds: ["3"],
      role: { value: "scrollbar" },
      backendDOMNodeId: 600,
    },
    {
      nodeId: "3",
      parentId: "2",
      role: { value: "StaticText" },
      name: { value: "50%" },
    },
  ] as Parameters<typeof buildNativeTree>[0];

  it("prints a bare scrollbar in buildNativeTree and nativeAXView", () => {
    expect(buildNativeTree(raw).nodes.get("ax-dom-600")?.a11y.name).toBe("");
    expect(nativeAXView(raw).tree).toBe("scrollbar");
  });
});

describe("buildNativeTree — a role-less editor's value never names the item around it", () => {
  // Chromium 151's shape for `<li><div contenteditable>typed</div></li>`: the
  // editor is a generic carrying the typed text as its value, and its
  // StaticText sits under it. It is a field, so it is kept, with the text as
  // its value — never as its name or the listitem's.
  const TYPED_SECRET = "typed-SECRET-li";
  const raw = [
    { nodeId: "1", childIds: ["2"], role: { value: "RootWebArea" } },
    { nodeId: "2", parentId: "1", childIds: ["3"], role: { value: "list" } },
    {
      nodeId: "3",
      parentId: "2",
      childIds: ["4"],
      role: { value: "listitem" },
      backendDOMNodeId: 500,
    },
    {
      nodeId: "4",
      parentId: "3",
      childIds: ["5"],
      role: { value: "generic" },
      value: { value: TYPED_SECRET },
    },
    {
      nodeId: "5",
      parentId: "4",
      role: { value: "StaticText" },
      name: { value: TYPED_SECRET },
    },
  ] as Parameters<typeof buildNativeTree>[0];

  it("keeps it out of every name in buildNativeTree and nativeAXView", () => {
    const tree = buildNativeTree(raw);
    expect(tree.nodes.get("ax-dom-500")?.a11y.name).toBe("");
    expect(serializeTree(tree, { includeGeneric: true })).not.toContain(
      "SECRET",
    );
    expect(nativeAXView(raw).tree).toBe("list\n  listitem\n    generic");
  });

  it("shows it as the editor's own value, and withholds it in strict mode", () => {
    const editor = (options: { redactInput?: boolean }) =>
      nodesOf(buildNativeTree(raw, new Map(), undefined, options)).find(
        (n) => n.a11y.role === "generic",
      );
    expect(editor({})?.a11y).toMatchObject({ name: "", value: TYPED_SECRET });
    expect(editor({ redactInput: true })?.a11y.value).toBeUndefined();
  });
});

describe("buildNativeTree — R1: typed text beside a kept child must not leak via the name", () => {
  // Chromium 151's shape for `<div role="textbox" contenteditable>typed
  // <a href="#">link</a> more</div>`: the typed text is on the textbox's own
  // StaticText children, around a kept link. Core names a paragraph from that
  // same shape, so it must never do it for a textbox — whether or not
  // Chromium also reports the text as the textbox's value.
  const raw = [
    { nodeId: "1", childIds: ["2"], role: { value: "RootWebArea" } },
    { nodeId: "2", parentId: "1", childIds: ["3"], role: { value: "main" } },
    {
      nodeId: "3",
      parentId: "2",
      childIds: ["4", "5", "7"],
      role: { value: "textbox" },
      name: { value: "" },
      backendDOMNodeId: 300,
    },
    {
      nodeId: "4",
      parentId: "3",
      role: { value: "StaticText" },
      name: { value: "typed-SECRET " },
    },
    {
      nodeId: "5",
      parentId: "3",
      childIds: ["6"],
      role: { value: "link" },
      name: { value: "link" },
    },
    {
      nodeId: "6",
      parentId: "5",
      role: { value: "StaticText" },
      name: { value: "link" },
    },
    {
      nodeId: "7",
      parentId: "3",
      role: { value: "StaticText" },
      name: { value: " more" },
    },
  ] as Parameters<typeof buildNativeTree>[0];

  it("core leaves the textbox unnamed (the typed text never reaches a name)", () => {
    const textbox = normalizeNativeAX(raw).find((n) => n.id === "ax-dom-300");
    expect(textbox?.role).toBe("textbox");
    expect(textbox?.name).toBe("");
  });

  it("keeps it out of buildNativeTree and nativeAXView", () => {
    const tree = buildNativeTree(raw);
    expect(tree.nodes.get("ax-dom-300")?.a11y.name).toBe("");
    expect(serializeTree(tree, { includeGeneric: true })).not.toContain(
      "SECRET",
    );
    const { tree: view } = nativeAXView(raw);
    expect(view).toBe('main\n  textbox\n    link "link"');
  });
});

describe("nativeAXView — the shared vocabulary, not a private copy", () => {
  const node = (
    nodeId: string,
    role: string,
    opts: { parentId?: string; childIds?: string[]; name?: string } = {},
  ) => ({
    nodeId,
    parentId: opts.parentId,
    childIds: opts.childIds ?? [],
    role: { value: role },
    ...(opts.name !== undefined ? { name: { value: opts.name } } : {}),
  });

  it("keeps a named generic and flattens a bare one", () => {
    const { tree } = nativeAXView([
      node("1", "RootWebArea", { childIds: ["2", "4"] }),
      node("2", "generic", {
        parentId: "1",
        childIds: ["3"],
        name: "YouTube Video Player",
      }),
      node("3", "button", { parentId: "2", name: "Play" }),
      node("4", "generic", { parentId: "1", childIds: ["5"] }),
      node("5", "button", { parentId: "4", name: "Mute" }),
    ]);
    expect(tree).toBe(
      'generic "YouTube Video Player"\n  button "Play"\nbutton "Mute"',
    );
  });

  it("maps Blink's Video/Audio/image roles to the engine's", () => {
    const { pairs } = nativeAXView([
      node("1", "RootWebArea", { childIds: ["2", "3", "4"] }),
      node("2", "Video", { parentId: "1" }),
      node("3", "Audio", { parentId: "1" }),
      node("4", "image", { parentId: "1", name: "Logo" }),
    ]);
    expect(pairs).toEqual(["video", "audio", 'img "Logo"']);
  });

  it("promotes a leaf's name from a dropped StaticText child", () => {
    const { pairs } = nativeAXView([
      node("1", "RootWebArea", { childIds: ["2"] }),
      node("2", "listitem", { parentId: "1", childIds: ["3"] }),
      node("3", "StaticText", { parentId: "2", name: "Alpha" }),
    ]);
    expect(pairs).toEqual(['listitem "Alpha"']);
  });

  it("agrees with buildNativeTree on the recorded payload, and leaks no secret", () => {
    const { tree, pairs } = nativeAXView(rawNodes, enrichment);
    // `pairs` is exactly the tree's lines with indentation stripped.
    expect(pairs).toEqual(tree.split("\n").map((l) => l.trim()));
    // Same survivors and names as the ExtractionResult producer (minus the
    // document root buildNativeTree synthesizes when there are several roots).
    const built = [...build().nodes.values()]
      .filter((n) => n.id !== "ax-root")
      .map((n) =>
        n.a11y.name ? `${n.a11y.role} "${n.a11y.name}"` : n.a11y.role,
      );
    expect([...pairs].sort()).toEqual([...built].sort());
    expect(tree).not.toContain(EMAIL_SECRET);
    expect(tree).not.toContain(PASSWORD_SECRET);
  });
});

describe("buildNativeTree — multiple top-level roots (normal single-frame page)", () => {
  // Core drops the RootWebArea, so a page whose body has several structural
  // children (header/main/footer) yields multiple parent-less roots. Without a
  // synthesized root, serializeTree would traverse only the first and silently
  // truncate the rest.
  const raw = [
    { nodeId: "1", childIds: ["2", "3", "4"], role: { value: "RootWebArea" } },
    {
      nodeId: "2",
      parentId: "1",
      role: { value: "banner" },
      name: { value: "Site header" },
      backendDOMNodeId: 10,
    },
    {
      nodeId: "3",
      parentId: "1",
      role: { value: "main" },
      name: { value: "Content" },
      backendDOMNodeId: 11,
    },
    {
      nodeId: "4",
      parentId: "1",
      role: { value: "contentinfo" },
      name: { value: "Site footer" },
      backendDOMNodeId: 12,
    },
  ] as Parameters<typeof buildNativeTree>[0];

  it("synthesizes one root that adopts every top-level section", () => {
    const tree = buildNativeTree(raw);
    const root = tree.nodes.get(tree.rootId);
    expect(root?.a11y.role).toBe("document");
    expect(root?.parentId).toBeNull();
    // all three landmarks are children of the synthesized root
    for (const id of ["ax-dom-10", "ax-dom-11", "ax-dom-12"]) {
      expect(tree.nodes.get(id)?.parentId).toBe(tree.rootId);
    }
    // and none are silently dropped from serialized output
    const printed = serializeTree(tree, { includeGeneric: true });
    expect(printed).toContain('banner "Site header"');
    expect(printed).toContain('main "Content"');
    expect(printed).toContain('contentinfo "Site footer"');
  });

  it("recomputes depth from the synthesized root", () => {
    const tree = buildNativeTree(raw);
    expect(tree.nodes.get(tree.rootId)?.depth).toBe(0);
    expect(tree.nodes.get("ax-dom-11")?.depth).toBe(1);
  });
});

describe("buildNativeTree — a range widget's value lives in a11y.value, never in properties", () => {
  const QTY_TEXT = "42 SECRET-QUANTITY";
  const raw = [
    { nodeId: "1", childIds: ["2"], role: { value: "RootWebArea" } },
    {
      nodeId: "2",
      parentId: "1",
      role: { value: "spinbutton" },
      name: { value: "Quantity" },
      backendDOMNodeId: 20,
      properties: [
        { name: "valuenow", value: { value: 42 } },
        { name: "valuetext", value: { value: QTY_TEXT } },
        { name: "valuemin", value: { value: 0 } },
      ],
    },
  ] as Parameters<typeof buildNativeTree>[0];
  const spinOf = (options: { redactInput?: boolean } = {}) =>
    buildNativeTree(
      raw,
      new Map([[20, domOf("input", { type: "number" })]]),
      undefined,
      options,
    ).nodes.get("ax-dom-20");

  it("announces valuetext over valuenow, and keeps authored bounds as properties", () => {
    const spin = spinOf();
    expect(spin?.a11y.role).toBe("spinbutton");
    expect(spin?.a11y.name).toBe("Quantity");
    expect(spin?.a11y.value).toBe(QTY_TEXT);
    // One home for a value: the sensitivity policy and strict mode both
    // govern `a11y.value`, and a copy here would route around them.
    expect(spin?.a11y.properties.valuenow).toBeUndefined();
    expect(spin?.a11y.properties.valuetext).toBeUndefined();
    expect(spin?.a11y.properties.valuemin).toBe("0"); // authored bound kept
  });

  it("withholds it in strict mode (redactInput)", () => {
    const spin = spinOf({ redactInput: true });
    expect(spin?.a11y.value).toBeUndefined();
    expect(JSON.stringify(spin)).not.toContain(QTY_TEXT);
  });
});

describe("buildNativeTree — focusedId", () => {
  // Chromium reports focus as a per-node `focused` AX property. Every
  // focus-aware consumer instead reads the tree-level `focusedId`:
  // `serializeTree`'s `[focused]` marker and `serializeTreeDiff`'s focus-move
  // line both look the node up by it. Without the promotion a native tree knows
  // where focus is and can't say so, and a `focus` action diffs to a bare
  // `a11y.states.focused` flip instead of a focus move.
  const focusedRaw = (focusedBackendId: number | null) =>
    [
      {
        nodeId: "1",
        childIds: ["10", "11"],
        backendDOMNodeId: 1,
        role: { value: "RootWebArea" },
        name: { value: "focus fixture" },
        properties: [
          // The document is marked focused whenever nothing in the page is —
          // and this node is dropped by the normalizer, so it must never
          // become the answer.
          { name: "focused", value: { value: focusedBackendId === null } },
        ],
      },
      {
        nodeId: "10",
        parentId: "1",
        childIds: [],
        backendDOMNodeId: 10,
        role: { value: "button" },
        name: { value: "Save" },
        properties:
          focusedBackendId === 10
            ? [{ name: "focused", value: { value: true } }]
            : [],
      },
      {
        nodeId: "11",
        parentId: "1",
        childIds: [],
        backendDOMNodeId: 11,
        role: { value: "textbox" },
        name: { value: "Email" },
        properties:
          focusedBackendId === 11
            ? [{ name: "focused", value: { value: true } }]
            : [],
      },
    ] as Parameters<typeof buildNativeTree>[0];

  it("points at the focused node", () => {
    const tree = buildNativeTree(focusedRaw(11));
    expect(tree.focusedId).toBe("ax-dom-11");
    expect(tree.nodes.get(tree.focusedId!)?.a11y.name).toBe("Email");
    expect(serializeTree(tree)).toContain("[focused]");
  });

  it("moves with focus", () => {
    expect(buildNativeTree(focusedRaw(10)).focusedId).toBe("ax-dom-10");
  });

  it("is unset when only the document is focused — nothing in the page is", () => {
    // The document node doesn't survive normalization, so pointing at it would
    // leave `focusedId` naming a node the tree doesn't contain.
    const tree = buildNativeTree(focusedRaw(null));
    expect(tree.focusedId).toBeUndefined();
    expect(serializeTree(tree)).not.toContain("[focused]");
  });

  it("never names a node outside the tree", () => {
    // The recorded payload marks only its RootWebArea focused, which is the
    // real-world shape of "nothing is focused".
    for (const tree of [build(), buildNativeTree(focusedRaw(11))]) {
      if (tree.focusedId !== undefined) {
        expect(tree.nodes.has(tree.focusedId)).toBe(true);
      }
    }
    expect(build().focusedId).toBeUndefined();
  });
});

describe("buildNativeTree — an editor's content is page content by default (ADR-0001)", () => {
  // The same recording the strict-mode tests below use.
  const EDITOR_SECRET = "EDITOR-SECRET";
  const tree = buildNativeTree(
    editorPayload.nodes as RawNodes,
    enrichmentOf(editorPayload.enrich),
    editorPayload.chrome,
  );
  const named = (role: string, name: string) =>
    nodesOf(tree).filter((n) => n.a11y.role === role && n.a11y.name === name);

  it("shows the typed text the way a screen reader reads it: in the names inside, and as the host's value", () => {
    expect(named("heading", `${EDITOR_SECRET}-heading`)).toHaveLength(1);
    expect(named("link", `${EDITOR_SECRET}-link`)).toHaveLength(1);
    const host = named("textbox", "Message")[0];
    expect(host.a11y.value).toContain(`${EDITOR_SECRET}-para`);
    // A role-less editor is its own field, holding its own text.
    expect(
      nodesOf(tree).find((n) => n.a11y.value === `${EDITOR_SECRET}-plain`)?.a11y
        .role,
    ).toBe("generic");
    // A <textarea> is a field like any other.
    expect(named("textbox", "Notes")[0].a11y.value).toBe(
      `${EDITOR_SECRET}-textarea`,
    );
  });

  it("keeps the dom facet as it is outside strict mode — a link keeps its href", () => {
    const link = named("link", `${EDITOR_SECRET}-link`)[0];
    expect(link.dom?.attributes.href).toContain("token=");
  });

  it("never names the host after its own value", () => {
    expect(named("textbox", "Message")).toHaveLength(1);
  });
});

describe("buildNativeTree — strict mode (redactInput): what a user typed into an editor never reaches the tree", () => {
  // A REAL recorded payload (Chromium 151, __fixtures__/native-ax-editor.json;
  // the page is in its `html` key): a contenteditable `role="textbox"`
  // message box holding paragraphs, a link, a heading, a list, a table, a
  // figure and two `contenteditable="false"` islands, plus a role-less
  // contenteditable and a <textarea>. Chromium reports the whole editor text
  // as the host's AX `value` — which strict mode never copies — and then again
  // as the names of the nodes inside it, which is the path these tests pin
  // shut.
  const EDITOR_SECRET = "EDITOR-SECRET";
  const STRICT = { redactInput: true };
  const editorRaw = editorPayload.nodes as Parameters<
    typeof buildNativeTree
  >[0];
  const editorEnrichment = enrichmentOf(editorPayload.enrich);
  const buildEditor = () =>
    buildNativeTree(editorRaw, editorEnrichment, editorPayload.chrome, STRICT);
  const find = (
    tree: ReturnType<typeof buildNativeTree>,
    role: string,
    name?: string,
  ) =>
    [...tree.nodes.values()].filter(
      (n) =>
        n.a11y.role === role && (name === undefined || n.a11y.name === name),
    );

  it("the recorded payload DID carry the typed text, as names and as the host's value (guards the tests)", () => {
    const raw = JSON.stringify(editorPayload.nodes);
    expect(raw).toContain(`"name":{"value":"${EDITOR_SECRET}-heading"`);
    const host = editorPayload.nodes.find(
      (n) => n.role?.value === "textbox" && n.name?.value === "Message",
    );
    expect(String(host?.value?.value)).toContain(`${EDITOR_SECRET}-para`);
    // And the enrichment carried the typed link's URL.
    expect(JSON.stringify(editorPayload.enrich)).toContain(
      `token=${EDITOR_SECRET}-href`,
    );
  });

  it("surfaces no typed text anywhere in the model", () => {
    const tree = buildEditor();
    expect(serializeTree(tree, { includeGeneric: true })).not.toContain(
      EDITOR_SECRET,
    );
    expect(JSON.stringify([...tree.nodes.values()])).not.toContain(
      EDITOR_SECRET,
    );
  });

  it("applies the same redaction to nativeAXView (nativeAX())", () => {
    const { tree, pairs } = nativeAXView(editorRaw, editorEnrichment, STRICT);
    expect(tree).not.toContain(EDITOR_SECRET);
    expect(JSON.stringify(pairs)).not.toContain(EDITOR_SECRET);
  });

  it("keeps the editor's structure: every role inside it is still there", () => {
    const printed = serializeTree(buildEditor(), { includeGeneric: true });
    // The host keeps its authored label, and what is inside it keeps its
    // shape — only the typed words are withheld.
    expect(printed).toContain('textbox "Message"');
    expect(printed).toMatch(/^ {4}paragraph$/m);
    expect(printed).toContain('heading "[redacted]" (level 2)');
    expect(printed).toMatch(/^ {4}list$/m);
    expect(printed).toMatch(/^ {6}listitem\b/m);
    expect(printed).toContain('cell "[redacted]"');
    expect(printed).toMatch(/^ {4}figure$/m);
  });

  it("names a node Chromium named from typed content with a placeholder, not nothing", () => {
    // Blank would be a lie the audit acts on: an empty-named link or cell
    // reads as UNLABELED, and `no-unlabeled-interactive` is an error — every
    // page with a link in its composer would fail CI. The placeholder says
    // "this has a name, withheld", which is true.
    const tree = buildEditor();
    expect(find(tree, "link", "[redacted]")).toHaveLength(2); // typed + island
    expect(find(tree, "heading", "[redacted]")).toHaveLength(1);
    expect(find(tree, "cell", "[redacted]")).toHaveLength(1);
  });

  it("keeps names that come from the page's own markup inside the editor", () => {
    const tree = buildEditor();
    // aria-label on a mention chip, alt on an inserted image: authored
    // attributes, not the editor's text.
    expect(find(tree, "link", "Mention Alice")).toHaveLength(1);
    expect(find(tree, "img", "Diagram")).toHaveLength(1);
  });

  it("never promotes typed text into a paragraph, a list item, or the container a role-less editor sits in", () => {
    const tree = buildEditor();
    for (const role of ["paragraph", "listitem", "Figcaption"]) {
      for (const node of find(tree, role)) {
        if (node.a11y.name === "Press Enter to send") continue; // outside
        expect(node.a11y.name).toBe("");
      }
    }
    // A role-less contenteditable is a bare `generic`, dropped — so its
    // `<article>` became a leaf and used to promote the typed text into its
    // OWN name. The article is not editable; the text it took was.
    expect(find(tree, "article")).toHaveLength(1);
    expect(find(tree, "article")[0].a11y.name).toBe("");
  });

  it("drops the URL a user typed or pasted into a link or image inside the editor", () => {
    // No sink prints `href`/`src` today, but R1 is by construction: an
    // auto-linked `?token=` URL is the likeliest secret in a message box, and
    // it must not be on the model for a future sink to find.
    const tree = buildEditor();
    const insideLinks = [
      ...find(tree, "link", "[redacted]"),
      ...find(tree, "link", "Mention Alice"),
    ];
    expect(insideLinks).toHaveLength(3);
    for (const link of insideLinks) {
      expect(link.dom?.tagName).toBe("a"); // still DOM-backed…
      expect(link.dom?.attributes.href).toBeUndefined(); // …minus the URL
    }
    const image = find(tree, "img", "Diagram")[0];
    expect(image.dom?.attributes.src).toBeUndefined();
    expect(image.dom?.attributes.alt).toBe("Diagram"); // markup kept
  });

  it("fails closed when Chromium's name trace is missing or disagrees with the name", () => {
    // A markup name is only kept when the trace PROVES it: a payload without
    // `sources` (older Chromium, a trimmed recording), or one whose winning
    // source isn't the text the node ended up named, reads as withheld.
    const host = {
      nodeId: "2",
      parentId: "1",
      childIds: ["3", "4", "5"],
      role: { value: "textbox" },
      name: { value: "Message" },
      properties: [{ name: "editable", value: { value: "richtext" } }],
      backendDOMNodeId: 20,
    };
    const link = (
      nodeId: string,
      name: { value: string; sources?: unknown[] },
    ) => ({
      nodeId,
      parentId: "2",
      role: { value: "link" },
      name,
      backendDOMNodeId: 30 + Number(nodeId),
    });
    const raw = [
      { nodeId: "1", childIds: ["2"], role: { value: "RootWebArea" } },
      host,
      link("3", { value: "untraced" }),
      link("4", {
        value: "typed text",
        sources: [
          { type: "attribute", attribute: "aria-label", value: { value: "x" } },
        ],
      }),
      link("5", {
        value: "Mention Alice",
        sources: [
          {
            type: "attribute",
            attribute: "aria-label",
            value: { value: "Mention Alice" },
          },
        ],
      }),
    ] as Parameters<typeof buildNativeTree>[0];
    const tree = buildNativeTree(raw, new Map(), undefined, STRICT);
    expect(tree.nodes.get("ax-dom-33")?.a11y.name).toBe("[redacted]");
    expect(tree.nodes.get("ax-dom-34")?.a11y.name).toBe("[redacted]");
    expect(tree.nodes.get("ax-dom-35")?.a11y.name).toBe("Mention Alice");
    expect(tree.nodes.get("ax-dom-20")?.a11y.name).toBe("Message"); // the host
  });

  it("withholds typed text from a node that CONTAINS an editor and is named from its contents", () => {
    // A second recording (Chromium 151, native-ax-editor-hosts.json): an
    // inline-editable <span> inside an <h3> and inside a <button>. Neither
    // the heading nor the button is in an editable region, but Chromium names
    // both from their contents — which include the typed text.
    const hostsRaw = hostsPayload.nodes as Parameters<
      typeof buildNativeTree
    >[0];
    expect(JSON.stringify(hostsRaw)).toContain(
      '"value":"Title: HOST-SECRET-inline"',
    ); // the vector is real
    const tree = buildNativeTree(hostsRaw, new Map(), undefined, STRICT);
    expect(JSON.stringify([...tree.nodes.values()])).not.toContain(
      "HOST-SECRET",
    );
    expect(nativeAXView(hostsRaw, new Map(), STRICT).tree).not.toContain(
      "HOST-SECRET",
    );

    // Named, just not shown — so audit doesn't call the button unlabeled.
    expect(find(tree, "heading", "[redacted]")).toHaveLength(1);
    expect(find(tree, "button", "[redacted]")).toHaveLength(1);
    // An editable root itself: Chromium leaves an <h2 contenteditable>
    // unnamed, and promotion finds only blanked text.
    expect(find(tree, "heading", "")).toHaveLength(1);
    // Labels that come from outside the field are the page's, and stay.
    expect(find(tree, "heading", "Page")).toHaveLength(1);
    for (const label of ["Composer", "Email", "Notes"]) {
      expect(find(tree, "textbox", label)).toHaveLength(1);
    }
  });

  it("leaves everything outside the editor untouched", () => {
    const tree = buildEditor();
    expect(find(tree, "heading", "Compose")).toHaveLength(1);
    expect(find(tree, "paragraph", "Press Enter to send")).toHaveLength(1);
    const help = find(tree, "link", "Help");
    expect(help).toHaveLength(1);
    expect(help[0].dom?.attributes.href).toBe("/help");
    // The host's description is page-authored help text outside the editor.
    expect(find(tree, "textbox", "Message")[0].a11y.description).toBe(
      "Press Enter to send",
    );
    // A <textarea>'s label is its authored name; only its value is withheld.
    expect(find(tree, "textbox", "Notes")).toHaveLength(1);
  });
});

describe("buildNativeTree — sensitive values in states, references and races", () => {
  const select = () =>
    [
      { nodeId: "1", childIds: ["2"], role: { value: "RootWebArea" } },
      {
        nodeId: "2",
        parentId: "1",
        childIds: ["3"],
        role: { value: "combobox" },
        name: { value: "Expiry month" },
        value: { value: "04" },
        backendDOMNodeId: 20,
      },
      {
        nodeId: "3",
        parentId: "2",
        childIds: ["4", "5"],
        role: { value: "MenuListPopup" },
        backendDOMNodeId: 21,
      },
      ...["01", "04"].map((label, i) => ({
        nodeId: String(4 + i),
        parentId: "3",
        role: { value: "option" },
        name: { value: label },
        properties: [{ name: "selected", value: { value: label === "04" } }],
        backendDOMNodeId: 22 + i,
      })),
    ] as RawNodes;
  const enrichSelect = (autocomplete?: string) =>
    new Map<number, NativeDomInfo>([
      [20, domOf("select", autocomplete ? { autocomplete } : {})],
      [21, domOf("div")],
      [22, domOf("option")],
      [23, domOf("option")],
    ]);
  const selectedOf = (
    autocomplete: string | undefined,
    options: { redactInput?: boolean } = {},
  ) =>
    nodesOf(
      buildNativeTree(select(), enrichSelect(autocomplete), undefined, options),
    )
      .filter((n) => n.a11y.role === "option")
      .map((n) => n.a11y.states.selected);

  it("keeps which option is selected on an ordinary select", () => {
    expect(selectedOf(undefined)).toEqual([false, true]);
  });

  it("drops it inside a sensitive select, whose value it would give away", () => {
    expect(selectedOf("cc-exp-month")).toEqual([undefined, undefined]);
  });

  it("drops it inside any choice field in strict mode", () => {
    expect(selectedOf(undefined, { redactInput: true })).toEqual([
      undefined,
      undefined,
    ]);
  });

  const referencing = (property: "labelledby" | "describedby") =>
    [
      { nodeId: "1", childIds: ["2", "3"], role: { value: "RootWebArea" } },
      {
        nodeId: "2",
        parentId: "1",
        role: { value: "textbox" },
        name: { value: "Card" },
        value: { value: "4111 1111 1111 1111" },
        backendDOMNodeId: 30,
      },
      {
        nodeId: "3",
        parentId: "1",
        role: { value: "button" },
        name: {
          value: property === "labelledby" ? "4111 1111 1111 1111" : "Pay now",
          sources: [
            property === "labelledby"
              ? {
                  type: "relatedElement",
                  value: { value: "4111 1111 1111 1111" },
                }
              : { type: "contents", value: { value: "Pay now" } },
          ],
        },
        ...(property === "describedby"
          ? { description: { value: "4111 1111 1111 1111" } }
          : {}),
        properties: [
          {
            name: property,
            value: { relatedNodes: [{ backendDOMNodeId: 30 }] },
          },
        ],
        backendDOMNodeId: 31,
      },
    ] as RawNodes;
  const referencingTree = (property: "labelledby" | "describedby") =>
    buildNativeTree(
      referencing(property),
      new Map([
        [30, domOf("input", { autocomplete: "cc-number" })],
        [31, domOf("button")],
      ]),
    );

  it("withholds a name taken from a sensitive field by aria-labelledby", () => {
    const tree = referencingTree("labelledby");
    expect(tree.nodes.get("ax-dom-31")?.a11y.name).toBe("[redacted]");
    expect(JSON.stringify(nodesOf(tree))).not.toContain("4111");
  });

  it("drops a description taken from one by aria-describedby", () => {
    const tree = referencingTree("describedby");
    expect(tree.nodes.get("ax-dom-31")?.a11y).toMatchObject({
      name: "Pay now",
      description: "",
    });
    expect(JSON.stringify(nodesOf(tree))).not.toContain("4111");
  });

  it("fails closed for a field the DOM walk never saw: the cell around it is withheld too", () => {
    // The page re-rendered between the AX read and the DOM read: the input
    // has no DOM record to say it is a card field. Its value is withheld, and
    // so is the cell Chromium named after it.
    const raw = [
      { nodeId: "1", childIds: ["2"], role: { value: "RootWebArea" } },
      {
        nodeId: "2",
        parentId: "1",
        childIds: ["3"],
        role: { value: "cell" },
        name: {
          value: "4111 1111",
          sources: [{ type: "contents", value: { value: "4111 1111" } }],
        },
        backendDOMNodeId: 40,
      },
      {
        nodeId: "3",
        parentId: "2",
        role: { value: "textbox" },
        name: { value: "" },
        value: { value: "4111 1111" },
        backendDOMNodeId: 41,
      },
    ] as RawNodes;
    const tree = buildNativeTree(raw, new Map([[40, domOf("td")]]));
    expect(tree.nodes.get("ax-dom-40")?.a11y.name).toBe("[redacted]");
    expect(tree.nodes.get("ax-dom-41")?.a11y.value).toBe("[redacted]");
  });
});

describe("buildNativeTree — strict mode around native text fields", () => {
  const STRICT = { redactInput: true };
  const cellAround = (value: string, sources?: unknown[]) =>
    [
      { nodeId: "1", childIds: ["2"], role: { value: "RootWebArea" } },
      {
        nodeId: "2",
        parentId: "1",
        childIds: ["3"],
        role: { value: "cell" },
        name: { value: value || "Quantity", ...(sources ? { sources } : {}) },
        backendDOMNodeId: 50,
      },
      {
        nodeId: "3",
        parentId: "2",
        role: { value: "textbox" },
        name: { value: "Quantity" },
        value: { value },
        properties: [{ name: "editable", value: { value: "plaintext" } }],
        backendDOMNodeId: 51,
      },
    ] as RawNodes;
  const cellName = (value: string, sources?: unknown[]) =>
    buildNativeTree(
      cellAround(value, sources),
      new Map([
        [50, domOf("td")],
        [51, domOf("input")],
      ]),
      undefined,
      STRICT,
    ).nodes.get("ax-dom-50")?.a11y.name;

  it("leaves a cell around an EMPTY input named — nothing typed is in it", () => {
    expect(
      cellName("", [{ type: "contents", value: { value: "Quantity" } }]),
    ).toBe("Quantity");
  });

  it("withholds a cell around a FILLED one that Chromium named from its contents", () => {
    expect(cellName("3", [{ type: "contents", value: { value: "3" } }])).toBe(
      "[redacted]",
    );
  });

  it("fails closed on an ancestor whose name has no trace, but keeps the field's own label", () => {
    const tree = buildNativeTree(
      cellAround("3"),
      new Map([
        [50, domOf("td")],
        [51, domOf("input")],
      ]),
      undefined,
      STRICT,
    );
    expect(tree.nodes.get("ax-dom-50")?.a11y.name).toBe("[redacted]");
    expect(tree.nodes.get("ax-dom-51")?.a11y.name).toBe("Quantity");
  });
});

describe("buildNativeTree — names taken by reference (<label>, aria-labelledby)", () => {
  // Chromium reports a `labelledby` property, with the referenced nodes, for a
  // <label> as well as aria-labelledby.
  const labelledBy = (backendId: number) => [
    {
      name: "labelledby",
      value: { relatedNodes: [{ backendDOMNodeId: backendId }] },
    },
  ];
  const traced = (text: string) => ({
    value: text,
    sources: [{ type: "relatedElement", value: { value: text } }],
  });

  it("keeps a field's name from its own wrapping <label> — the label's only field is itself", () => {
    // <label>Password <input type=password></label>
    const raw = [
      { nodeId: "1", childIds: ["2"], role: { value: "RootWebArea" } },
      {
        nodeId: "2",
        parentId: "1",
        childIds: ["3", "4"],
        role: { value: "LabelText" },
        backendDOMNodeId: 60,
      },
      {
        nodeId: "3",
        parentId: "2",
        role: { value: "StaticText" },
        name: { value: "Password" },
      },
      {
        nodeId: "4",
        parentId: "2",
        role: { value: "textbox" },
        name: traced("Password"),
        value: { value: "••••" },
        properties: labelledBy(60),
        backendDOMNodeId: 61,
      },
    ] as RawNodes;
    const tree = buildNativeTree(
      raw,
      new Map([
        [60, domOf("label")],
        [61, domOf("input", { type: "password" })],
      ]),
    );
    expect(tree.nodes.get("ax-dom-61")?.a11y).toMatchObject({
      name: "Password",
      value: "[redacted]",
    });
  });

  // <label><input type=checkbox> Remind me <input value="47"> minutes</label>,
  // and a region labelled by the editable heading inside it.
  const referencing = [
    { nodeId: "1", childIds: ["2", "6"], role: { value: "RootWebArea" } },
    {
      nodeId: "2",
      parentId: "1",
      childIds: ["3", "4"],
      role: { value: "LabelText" },
      backendDOMNodeId: 70,
    },
    {
      nodeId: "3",
      parentId: "2",
      role: { value: "checkbox" },
      name: traced("Remind me 47 minutes"),
      properties: labelledBy(70),
      backendDOMNodeId: 71,
    },
    {
      nodeId: "4",
      parentId: "2",
      role: { value: "textbox" },
      name: { value: "Minutes" },
      value: { value: "47" },
      properties: [{ name: "editable", value: { value: "plaintext" } }],
      backendDOMNodeId: 72,
    },
    {
      nodeId: "6",
      parentId: "1",
      childIds: ["7"],
      role: { value: "region" },
      name: traced("Q3 plan"),
      properties: labelledBy(81),
      backendDOMNodeId: 80,
    },
    {
      nodeId: "7",
      parentId: "6",
      role: { value: "heading" },
      name: { value: "" },
      value: { value: "Q3 plan" },
      properties: [{ name: "editable", value: { value: "richtext" } }],
      backendDOMNodeId: 81,
    },
  ] as RawNodes;
  const referencingTree = (options: { redactInput?: boolean }) =>
    buildNativeTree(
      referencing,
      new Map([
        [70, domOf("label")],
        [71, domOf("input", { type: "checkbox" })],
        [72, domOf("input")],
        [80, domOf("section")],
        [81, domOf("h1")],
      ]),
      undefined,
      options,
    );

  it("by default, a name built from ordinary field or editor text is page content", () => {
    const tree = referencingTree({});
    expect(tree.nodes.get("ax-dom-71")?.a11y.name).toBe("Remind me 47 minutes");
    expect(tree.nodes.get("ax-dom-80")?.a11y.name).toBe("Q3 plan");
  });

  it("strict mode withholds a name taken from another field or an editor", () => {
    const tree = referencingTree({ redactInput: true });
    expect(tree.nodes.get("ax-dom-71")?.a11y.name).toBe("[redacted]");
    expect(tree.nodes.get("ax-dom-80")?.a11y.name).toBe("[redacted]");
    // The field that holds the value keeps its own label.
    expect(tree.nodes.get("ax-dom-72")?.a11y.name).toBe("Minutes");
    expect(JSON.stringify(nodesOf(tree))).not.toMatch(/47|Q3 plan/);
  });
});
