// Unit tests for the native producer's pure assembly (`buildNativeTree`) and
// its redaction gate (`allowlistAttributes`), run against a REAL recorded
// `Accessibility.getFullAXTree` + `DOM.getDocument` payload (Chromium 141,
// __fixtures__/native-ax-payload.json) — a fixture page carrying a `<video>`
// with UA-shadow controls and email/password fields with real secret values.
// No browser needed at test time; the recording IS the browser's output.

import { normalizeNativeAX } from "@real-a11y-dev/core";
import { serializeTree } from "@real-a11y-dev/serialize";
import { describe, expect, it } from "vitest";

import editorPayload from "./__fixtures__/native-ax-editor.json";
import payload from "./__fixtures__/native-ax-payload.json";
import {
  allowlistAttributes,
  buildNativeTree,
  nativeAXView,
} from "./native-tree.js";

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

  it("applies the same redaction to nativeAXView (nativeAX())", () => {
    const { tree, pairs } = nativeAXView(raw);
    expect(tree).toBe('main\n  textbox\n  textbox "Email"');
    expect(pairs).toEqual(["main", "textbox", 'textbox "Email"']);
    expect(JSON.stringify(pairs)).not.toContain(TYPED_SECRET);
  });
});

describe("buildNativeTree — R1: typed text beside a kept child must not leak via the name", () => {
  // Chromium 151's shape for `<div role="textbox" contenteditable>typed
  // <a href="#">link</a> more</div>`: the typed text is on the textbox's own
  // StaticText children, around a kept link. Core names a paragraph from that
  // same shape, so it must never do it for a textbox — not even leaving it to
  // the redaction above, which the extension's native path doesn't apply.
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
    const { tree, pairs } = nativeAXView(rawNodes);
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

describe("buildNativeTree — R1: what a user typed into an editor never reaches the tree", () => {
  // A REAL recorded payload (Chromium 151, __fixtures__/native-ax-editor.json;
  // the page is in its `html` key): a contenteditable `role="textbox"`
  // message box holding paragraphs, a link, a heading, a list, a table, a
  // figure and two `contenteditable="false"` islands, plus a role-less
  // contenteditable and a <textarea>. Chromium reports the whole editor text
  // as the host's AX `value` — which R1 already drops — and then again as the
  // names of the nodes inside it, which is the leak these tests pin shut.
  const EDITOR_SECRET = "EDITOR-SECRET";
  const editorRaw = editorPayload.nodes as Parameters<
    typeof buildNativeTree
  >[0];
  const editorEnrichment = new Map(
    Object.entries(editorPayload.enrich).map(([backendId, e]) => [
      Number(backendId),
      {
        tagName: e.tagName.toLowerCase(),
        attributes: allowlistAttributes(e.attributes),
      },
    ]),
  );
  const buildEditor = () =>
    buildNativeTree(editorRaw, editorEnrichment, editorPayload.chrome);
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
    const { tree, pairs } = nativeAXView(editorRaw);
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
    const tree = buildNativeTree(raw);
    expect(tree.nodes.get("ax-dom-33")?.a11y.name).toBe("[redacted]");
    expect(tree.nodes.get("ax-dom-34")?.a11y.name).toBe("[redacted]");
    expect(tree.nodes.get("ax-dom-35")?.a11y.name).toBe("Mention Alice");
    expect(tree.nodes.get("ax-dom-20")?.a11y.name).toBe("Message"); // the host
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
