// Unit tests for the native producer's pure assembly (`buildNativeTree`) and
// its redaction gate (`allowlistAttributes`), run against a REAL recorded
// `Accessibility.getFullAXTree` + `DOM.getDocument` payload (Chromium 141,
// __fixtures__/native-ax-payload.json) — a fixture page carrying a `<video>`
// with UA-shadow controls and email/password fields with real secret values.
// No browser needed at test time; the recording IS the browser's output.

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
