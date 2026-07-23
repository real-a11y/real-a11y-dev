// Unit tests for the native producer's pure assembly (`buildNativeTree`) and
// its redaction gate (`allowlistAttributes`), run against a REAL recorded
// `Accessibility.getFullAXTree` + `DOM.getDocument` payload (Chromium 141,
// __fixtures__/native-ax-payload.json) — a fixture page carrying a `<video>`
// with UA-shadow controls and email/password fields with real secret values.
// No browser needed at test time; the recording IS the browser's output.

import { normalizeNativeAX } from "@real-a11y-dev/core";
import { serializeTree } from "@real-a11y-dev/serialize";
import { describe, expect, it } from "vitest";

import payload from "./__fixtures__/native-ax-payload.json";
import { allowlistAttributes, buildNativeTree } from "./native-tree.js";

const EMAIL_SECRET = "secret-user@example.com";
const PASSWORD_SECRET = "hunter2-SECRET";

const rawNodes = payload.nodes as Parameters<typeof buildNativeTree>[0];
const enrichment = new Map(
  Object.entries(payload.enrich).map(([backendId, e]) => [
    Number(backendId),
    {
      tagName: (e as { tagName: string }).tagName.toLowerCase(),
      attributes: allowlistAttributes(
        (e as { attributes: string[] }).attributes,
      ),
    },
  ]),
);

function build() {
  return buildNativeTree(rawNodes, enrichment, payload.chrome);
}

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

describe("buildNativeTree — R1: no field value ever reaches the tree", () => {
  it("never surfaces the email or password secret anywhere in the model", () => {
    const tree = build();
    // Whole serialized model — names, states, dom attributes, everything.
    const serialized = serializeTree(tree, { includeGeneric: true });
    expect(serialized).not.toContain(EMAIL_SECRET);
    expect(serialized).not.toContain(PASSWORD_SECRET);

    // And prove it structurally: walk every facet of every node.
    const blob = JSON.stringify([...tree.nodes.values()]);
    expect(blob).not.toContain(EMAIL_SECRET);
    expect(blob).not.toContain(PASSWORD_SECRET);
    // The email textbox is present (so absence isn't because the node was
    // dropped) — its label is the name, its value is gone.
    const email = [...tree.nodes.values()].find(
      (n) => n.a11y.role === "textbox" && /email/i.test(n.a11y.name),
    );
    expect(email).toBeDefined();
    expect(email!.dom?.attributes.value).toBeUndefined();
  });

  it("the recorded raw payload DID contain the secrets (guards the test)", () => {
    // If the fixture ever stops carrying real secrets, the test above is
    // vacuous — pin that the redaction is doing real work.
    expect(JSON.stringify(payload)).toContain(EMAIL_SECRET);
  });
});

describe("buildNativeTree — R1: unlabeled field value must not leak via the name", () => {
  // The fixture's inputs are all labeled, so the redaction path for an
  // UNLABELED control (where Chromium emits the typed value as a StaticText
  // descendant that core's name-promotion would pull into a11y.name) is not
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

  it("sanity: core's name-promotion DOES pull the value into the name (the leak)", () => {
    // Guards the fix below: prove the vector is real, so the redaction test
    // can never pass vacuously if promotion behaviour changes.
    const promoted = normalizeNativeAX(raw).find((n) => n.id === "ax-dom-100");
    expect(promoted?.name).toBe(TYPED_SECRET);
  });

  it("redacts the promoted value from an unlabeled control's name", () => {
    const tree = buildNativeTree(raw);
    const unlabeled = tree.nodes.get("ax-dom-100");
    expect(unlabeled?.a11y.role).toBe("textbox");
    expect(unlabeled?.a11y.name).toBe(""); // value dropped, not promoted
    expect(serializeTree(tree, { includeGeneric: true })).not.toContain(
      TYPED_SECRET,
    );
  });

  it("keeps an authored (labeled) control's name", () => {
    const labeled = buildNativeTree(raw).nodes.get("ax-dom-200");
    expect(labeled?.a11y.name).toBe("Email");
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

describe("buildNativeTree — R1: valuenow/valuetext of value controls must not leak", () => {
  const QTY_SECRET = "42 SECRET-QUANTITY";
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
        { name: "valuetext", value: { value: QTY_SECRET } },
        { name: "valuemin", value: { value: 0 } },
      ],
    },
  ] as Parameters<typeof buildNativeTree>[0];

  it("drops valuenow/valuetext but keeps authored bounds", () => {
    const tree = buildNativeTree(raw);
    const spin = tree.nodes.get("ax-dom-20");
    expect(spin?.a11y.role).toBe("spinbutton");
    expect(spin?.a11y.name).toBe("Quantity");
    expect(spin?.a11y.properties.valuenow).toBeUndefined();
    expect(spin?.a11y.properties.valuetext).toBeUndefined();
    expect(spin?.a11y.properties.valuemin).toBe("0"); // authored bound kept
    // the value never reaches the serialized model or any node facet
    expect(serializeTree(tree, { includeGeneric: true })).not.toContain(
      QTY_SECRET,
    );
    expect(JSON.stringify([...tree.nodes.values()])).not.toContain(QTY_SECRET);
  });
});
