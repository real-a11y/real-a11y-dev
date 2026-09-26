// Tests run against a RECORDED `Accessibility.getFullAXTree` payload
// (__fixtures__/ax-media-form.json, captured from Chromium 141 on a fixture
// page with media + form + list + presentational wrappers) — no browser in
// the loop, which is the point: the vocabulary is pure and testable offline.

import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/ax-media-form.json";
import mixedTextFixture from "./__fixtures__/ax-mixed-text.json";
import {
  normalizeNativeAX,
  serializeNativeAX,
  type NativeAXNode,
  type RawNativeAXNode,
} from "./ax-normalize.js";
import {
  mapNativeAXRole,
  NATIVE_AX_DROP_ROLES,
  NATIVE_AX_DROP_UNLESS_NAMED,
  NATIVE_AX_DROP_WHEN_BARE,
  NATIVE_AX_OWN_TEXT_ROLES,
  NATIVE_AX_VOCABULARY_VERSION,
} from "./ax-vocabulary.js";

const rawNodes = fixture.nodes as RawNativeAXNode[];

function byRole(nodes: NativeAXNode[], role: string): NativeAXNode[] {
  return nodes.filter((n) => n.role === role);
}

/** A hand-built raw AX node, carrying only the fields a case sets. */
function raw(
  nodeId: string,
  role: string,
  opts: {
    parentId?: string;
    childIds?: string[];
    name?: string;
    ignored?: boolean;
    properties?: RawNativeAXNode["properties"];
  } = {},
): RawNativeAXNode {
  return {
    nodeId,
    role: { value: role },
    ...(opts.name !== undefined ? { name: { value: opts.name } } : {}),
    ...(opts.parentId !== undefined ? { parentId: opts.parentId } : {}),
    ...(opts.childIds !== undefined ? { childIds: opts.childIds } : {}),
    ...(opts.ignored ? { ignored: true } : {}),
    ...(opts.properties !== undefined ? { properties: opts.properties } : {}),
  };
}

describe("native AX vocabulary", () => {
  it("is versioned", () => {
    expect(NATIVE_AX_VOCABULARY_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("maps Chromium-internal media roles to engine roles", () => {
    expect(mapNativeAXRole("Video")).toBe("video");
    expect(mapNativeAXRole("Audio")).toBe("audio");
    expect(mapNativeAXRole("image")).toBe("img");
    expect(mapNativeAXRole("button")).toBe("button");
  });

  it("drops text runs, wrappers, and Blink internals", () => {
    for (const role of [
      "StaticText",
      "InlineTextBox",
      "ListMarker",
      "RootWebArea",
    ]) {
      expect(NATIVE_AX_DROP_ROLES.has(role)).toBe(true);
    }
  });

  it("treats generic as drop-unless-named, not an unconditional drop", () => {
    expect(NATIVE_AX_DROP_ROLES.has("generic")).toBe(false);
    expect(NATIVE_AX_DROP_UNLESS_NAMED.has("generic")).toBe(true);
  });
});

describe("normalizeNativeAX (recorded Chromium 141 tree)", () => {
  const nodes = normalizeNativeAX(rawNodes);

  it("produces the engine-shaped tree, document-ordered", () => {
    expect(serializeNativeAX(nodes)).toBe(
      [
        "main",
        '  heading "Native AX fixture"',
        "  list",
        '    listitem "Alpha"',
        '    listitem "Beta"',
        '  textbox "Email"',
        '  button "Save"',
        // Control order below is Chromium's own childIds order — note it is
        // NOT the flat-list order the payload interleaves them in.
        '  video "Unable to play media."',
        '    group "buffering"',
        '    button "play"',
        '    button "mute"',
        '    button "enter full screen"',
        '    button "show more media controls"',
        '    slider "video time scrubber"',
        '  link "Deep link"',
      ].join("\n"),
    );
  });

  it("orders siblings by the parent's childIds, not flat-list position", () => {
    // In the recorded flat list the link node appears BEFORE the listitem
    // nodes — flat-position grouping (what the early spike normalizers did)
    // would serialize the link ahead of the list's children. Guard the
    // document order instead.
    const main = nodes[0];
    expect(main.role).toBe("main");
    const childRoles = main.childIds.map(
      (id) => nodes.find((n) => n.id === id)?.role,
    );
    expect(childRoles).toEqual([
      "heading",
      "list",
      "textbox",
      "button",
      "video",
      "link",
    ]);
  });

  it("keeps UA-shadow media controls under a video leaf-turned-parent", () => {
    const [video] = byRole(nodes, "video");
    const childLabels = video.childIds
      .map((id) => nodes.find((n) => n.id === id))
      .map((n) => `${n?.role} "${n?.name}"`);
    expect(childLabels).toContain('button "play"');
    expect(childLabels).toContain('slider "video time scrubber"');
    // Re-parented through [ignored]/none/generic wrapper layers.
    expect(video.depth).toBe(1);
    for (const id of video.childIds) {
      expect(nodes.find((n) => n.id === id)?.depth).toBe(2);
    }
  });

  it("promotes names from dropped StaticText children", () => {
    const items = byRole(nodes, "listitem");
    expect(items.map((n) => n.name)).toEqual(["Alpha", "Beta"]);
  });

  it("never overrides an authored name with child value text", () => {
    // The email textbox's StaticText descendant holds the field VALUE
    // ("user@example.com"); the name must stay the label.
    const [textbox] = byRole(nodes, "textbox");
    expect(textbox.name).toBe("Email");
    expect(serializeNativeAX(nodes)).not.toContain("user@example.com");
  });

  it("drops the RootWebArea so the landmark becomes the root at depth 0", () => {
    expect(nodes[0]).toMatchObject({ role: "main", depth: 0 });
    expect(byRole(nodes, "RootWebArea")).toHaveLength(0);
  });

  it("exposes backendDOMNodeId for dispatch/enrichment targeting", () => {
    const save = nodes.find((n) => n.role === "button" && n.name === "Save");
    expect(save?.backendDOMNodeId).toEqual(expect.any(Number));
    expect(save?.id).toBe(`ax-dom-${save?.backendDOMNodeId}`);
  });
});

describe("name promotion depth and guard", () => {
  it("promotes through nested dropped wrappers (LabelText → StaticText)", () => {
    // Chromium's common label shape: the LabelText carries NO name itself;
    // its text lives on a StaticText child — sometimes under a generic too.
    const nodes = normalizeNativeAX([
      raw("1", "checkbox", { childIds: ["2"] }),
      raw("2", "LabelText", { parentId: "1", childIds: ["3"] }),
      raw("3", "generic", { parentId: "2", childIds: ["4"] }),
      raw("4", "StaticText", { parentId: "3", name: "Accept terms" }),
    ]);
    expect(serializeNativeAX(nodes)).toBe('checkbox "Accept terms"');
  });

  it("never promotes onto a node with kept descendants (leaf guard)", () => {
    // A container whose dropped subtree contains label text must NOT steal
    // it — only normalized leaves promote. (In the recorded fixture: main's
    // dropped LabelText holds "Email"; main must stay unnamed.)
    const container = normalizeNativeAX([
      raw("1", "main", { childIds: ["2", "5"] }),
      raw("2", "LabelText", { parentId: "1", childIds: ["3"] }),
      raw("3", "StaticText", { parentId: "2", name: "Email" }),
      raw("5", "button", { parentId: "1", name: "Save" }),
    ]);
    expect(serializeNativeAX(container)).toBe(
      ["main", '  button "Save"'].join("\n"),
    );

    const fixture = normalizeNativeAX(rawNodes);
    expect(fixture[0]).toMatchObject({ role: "main", name: "" });
  });

  it("does not promote list markers (not a name-source role)", () => {
    const nodes = normalizeNativeAX([
      raw("1", "listitem", { childIds: ["2", "3"] }),
      raw("2", "ListMarker", { parentId: "1", name: "• " }),
      raw("3", "StaticText", { parentId: "1", name: "Alpha" }),
    ]);
    expect(serializeNativeAX(nodes)).toBe('listitem "Alpha"');
  });
});

describe("a node's own text (direct StaticText children)", () => {
  it("keeps a paragraph's plain text around its kept inline children", () => {
    // `<p>See <a>#386</a> and <code>x</code> here.</p>` — the paragraph is not
    // a leaf, so leaf-only promotion never ran and all three runs were lost.
    const nodes = normalizeNativeAX([
      raw("1", "paragraph", { childIds: ["2", "3", "5", "6", "8"] }),
      raw("2", "StaticText", { parentId: "1", name: "See " }),
      raw("3", "link", { parentId: "1", name: "#386", childIds: ["4"] }),
      raw("4", "StaticText", { parentId: "3", name: "#386" }),
      raw("5", "StaticText", { parentId: "1", name: " and " }),
      raw("6", "code", { parentId: "1", childIds: ["7"] }),
      raw("7", "StaticText", { parentId: "6", name: "x" }),
      raw("8", "StaticText", { parentId: "1", name: " here." }),
    ]);
    expect(serializeNativeAX(nodes)).toBe(
      ['paragraph "See and here."', '  link "#386"', '  code "x"'].join("\n"),
    );
  });

  it("concatenates every run of a leaf, not just the first", () => {
    // Chromium gives `<b>` no node of its own, so `<p>Pure <b>bold</b> text.</p>`
    // is a leaf with three StaticText children — first-match promotion
    // truncated it to "Pure".
    const nodes = normalizeNativeAX([
      raw("1", "paragraph", { childIds: ["2", "3", "4"] }),
      raw("2", "StaticText", { parentId: "1", name: "Pure " }),
      raw("3", "StaticText", { parentId: "1", name: "bold" }),
      raw("4", "StaticText", { parentId: "1", name: " text." }),
    ]);
    expect(serializeNativeAX(nodes)).toBe('paragraph "Pure bold text."');
  });

  it("reads a LineBreak as a space", () => {
    const nodes = normalizeNativeAX([
      raw("1", "paragraph", { childIds: ["2", "3", "4"] }),
      raw("2", "StaticText", { parentId: "1", name: "Line one" }),
      raw("3", "LineBreak", { parentId: "1", name: "\n" }),
      raw("4", "StaticText", { parentId: "1", name: "Line two" }),
    ]);
    expect(serializeNativeAX(nodes)).toBe('paragraph "Line one Line two"');
  });

  it("never lets a container take text from a dropped wrapper", () => {
    // Only DIRECT StaticText counts once a node has kept descendants: a
    // `main` must not be named after a loose `<div>` or a `<label>` inside it.
    const nodes = normalizeNativeAX([
      raw("1", "main", { childIds: ["2", "4", "6"] }),
      raw("2", "generic", { parentId: "1", childIds: ["3"] }),
      raw("3", "StaticText", { parentId: "2", name: "Loose block" }),
      raw("4", "LabelText", { parentId: "1", childIds: ["5"] }),
      raw("5", "StaticText", { parentId: "4", name: "Email" }),
      raw("6", "button", { parentId: "1", name: "Save" }),
    ]);
    expect(serializeNativeAX(nodes)).toBe(
      ["main", '  button "Save"'].join("\n"),
    );
  });

  // Chromium 151 leaves each of these unnamed even with a sentence of its own
  // beside a kept child: they are named by the author only, and that empty
  // name is what `dialog-labeled`, `image-alt` and `no-unlabeled-interactive`
  // report. `<div role="dialog">Delete this project? <button>Cancel</button>`
  // must not read as a labelled dialog.
  it.each([
    "dialog",
    "alertdialog",
    "image",
    "navigation",
    "form",
    "tree",
    "combobox",
    "textbox",
  ])("never names a %s from its own text", (role) => {
    const nodes = normalizeNativeAX([
      raw("1", role, { childIds: ["2", "3"] }),
      raw("2", "StaticText", { parentId: "1", name: "Delete this project? " }),
      raw("3", "button", { parentId: "1", name: "Cancel" }),
    ]);
    expect(nodes[0].name).toBe("");
  });

  it.each([...NATIVE_AX_OWN_TEXT_ROLES])(
    "names a %s from its own text beside a kept child",
    (role) => {
      const nodes = normalizeNativeAX([
        raw("1", role, { childIds: ["2", "3"] }),
        raw("2", "StaticText", { parentId: "1", name: "Own text " }),
        raw("3", "link", { parentId: "1", name: "kept" }),
      ]);
      expect(nodes[0].name).toBe("Own text");
    },
  );

  it("does not enter an ignored wrapper, even on a leaf with direct text", () => {
    // A clipped screen-reader-only span: Chromium ignores the span but not its
    // text. Its neighbours' whitespace has already collapsed around it, so
    // entering it would glue words ("screen-readertext").
    const nodes = normalizeNativeAX([
      raw("1", "paragraph", { childIds: ["2", "3", "5"] }),
      raw("2", "StaticText", { parentId: "1", name: "Visible " }),
      raw("3", "none", { parentId: "1", ignored: true, childIds: ["4"] }),
      raw("4", "StaticText", { parentId: "3", name: "screen-reader" }),
      raw("5", "StaticText", { parentId: "1", name: "text." }),
    ]);
    expect(serializeNativeAX(nodes)).toBe('paragraph "Visible text."');
  });

  it("skips an ignored StaticText", () => {
    const nodes = normalizeNativeAX([
      raw("1", "paragraph", { childIds: ["2", "3", "4"] }),
      raw("2", "StaticText", { parentId: "1", name: "Shown " }),
      raw("3", "StaticText", { parentId: "1", name: "hidden ", ignored: true }),
      raw("4", "StaticText", { parentId: "1", name: "text" }),
    ]);
    expect(serializeNativeAX(nodes)).toBe('paragraph "Shown text"');
  });

  it("never names a kept sectionheader after its byline", () => {
    // Name-from-author only, like the DOM producer: a focusable `<header>`
    // survives, but "By Ada" is not its name — with or without kept children.
    const focusable = [{ name: "focusable", value: { value: true } }];
    const withHeading = normalizeNativeAX([
      raw("1", "sectionheader", {
        childIds: ["2", "3"],
        properties: focusable,
      }),
      raw("2", "StaticText", { parentId: "1", name: "By Ada" }),
      raw("3", "heading", { parentId: "1", name: "Post" }),
    ]);
    expect(serializeNativeAX(withHeading)).toBe(
      ["sectionheader", '  heading "Post"'].join("\n"),
    );

    const leaf = normalizeNativeAX([
      raw("1", "sectionfooter", { childIds: ["2"], properties: focusable }),
      raw("2", "StaticText", { parentId: "1", name: "By Ada" }),
    ]);
    expect(serializeNativeAX(leaf)).toBe("sectionfooter");
  });

  it("still prefers the node's own name over any child text", () => {
    const nodes = normalizeNativeAX([
      raw("1", "paragraph", { name: "Authored", childIds: ["2"] }),
      raw("2", "StaticText", { parentId: "1", name: "Content" }),
    ]);
    expect(serializeNativeAX(nodes)).toBe('paragraph "Authored"');
  });
});

// Recorded from Chromium 151 on this page (a real `getFullAXTree` payload,
// trimmed to the fields the normalizer reads):
//
//   <main>
//   <p>Follow-up to <a href="#a">#386</a>/<a href="#b">#390</a>. Selecting a
//     row in <code>NativeTreeView.tsx</code>'s <code>selectedId</code>
//     <strong>and</strong> moves focus.</p>
//   <p>Pure <b>bold</b> text.</p>
//   <p>Line one<br>Line two</p>
//   <ul><li>Alpha <a href="#c">link</a> tail</li></ul>
//   <p>Visible <span style="position:absolute;width:1px;height:1px;
//     overflow:hidden;clip:rect(0 0 0 0)">screen-reader</span> text
//     <a href="#d">here</a>.</p>
//   <label>Email <input></label>
//   <div>Loose block</div>
//   <article><header tabindex="0">By Ada<h2>Post</h2></header></article>
//   <nav>Menu: <a href="#e">Home</a></nav>
//   <div role="dialog">Delete this project? <button>Cancel</button></div>
//   </main>
describe("normalizeNativeAX (recorded mixed inline text)", () => {
  const nodes = normalizeNativeAX(mixedTextFixture.nodes as RawNativeAXNode[]);

  it("keeps every paragraph's own text, and no author-named role takes one", () => {
    expect(serializeNativeAX(nodes)).toBe(
      [
        "main",
        '  paragraph "Follow-up to /. Selecting a row in \'s moves focus."',
        '    link "#386"',
        '    link "#390"',
        '    code "NativeTreeView.tsx"',
        '    code "selectedId"',
        '    strong "and"',
        '  paragraph "Pure bold text."',
        '  paragraph "Line one Line two"',
        "  list",
        '    listitem "Alpha tail"',
        '      link "link"',
        // The clipped span's text sits under an ignored wrapper — not the
        // paragraph's own text, exactly as the DOM producer reads it.
        '  paragraph "Visible text ."',
        '    link "here"',
        '  textbox "Email"',
        "  article",
        "    sectionheader",
        '      heading "Post"',
        // Author-named: their loose text is not a name, so a landmark and a
        // dialog stay unnamed — the dialog is still a `dialog-labeled` finding.
        "  navigation",
        '    link "Home"',
        "  dialog",
        '    button "Cancel"',
      ].join("\n"),
    );
  });
});

describe("named container preservation (generic)", () => {
  // Chromium exposes YouTube's player wrapper as `generic "YouTube Video
  // Player"` with the media controls beneath it. The named container must
  // survive so the grouping (and native↔DOM parity) is preserved.
  it("keeps a named generic as a labelled group with its children nested", () => {
    const nodes = normalizeNativeAX([
      raw("1", "complementary", { childIds: ["2"] }),
      raw("2", "generic", {
        parentId: "1",
        name: "YouTube Video Player",
        childIds: ["3", "4"],
      }),
      raw("3", "button", { parentId: "2", name: "Pause" }),
      raw("4", "slider", { parentId: "2", name: "Seek slider" }),
    ]);
    expect(serializeNativeAX(nodes)).toBe(
      [
        "complementary",
        '  generic "YouTube Video Player"',
        '    button "Pause"',
        '    slider "Seek slider"',
      ].join("\n"),
    );
  });

  // A bare generic is still noise: dropped, its children flattened up to the
  // nearest kept ancestor at the same depth (unchanged behavior).
  it("still drops a bare generic and flattens its children", () => {
    const nodes = normalizeNativeAX([
      raw("1", "complementary", { childIds: ["2"] }),
      raw("2", "generic", { parentId: "1", childIds: ["3", "4"] }),
      raw("3", "button", { parentId: "2", name: "Pause" }),
      raw("4", "slider", { parentId: "2", name: "Seek slider" }),
    ]);
    expect(serializeNativeAX(nodes)).toBe(
      ["complementary", '  button "Pause"', '  slider "Seek slider"'].join(
        "\n",
      ),
    );
  });
});

// HTML-AAM: <header>/<footer> inside main or sectioning content map to
// sectionheader/sectionfooter, which user agents MAY leave unexposed when
// bare. Chromium exposes them; we drop the bare ones so native agrees with
// the DOM producer's a11y view, and keep any that carry information.
describe("sectionheader / sectionfooter (drop when bare)", () => {
  const tree = (
    role: string,
    extra: { name?: string; properties?: RawNativeAXNode["properties"] },
  ) =>
    serializeNativeAX(
      normalizeNativeAX([
        raw("1", "main", { childIds: ["2"] }),
        raw("2", role, { parentId: "1", childIds: ["3"], ...extra }),
        raw("3", "heading", { parentId: "2", name: "Title" }),
      ]),
    );

  it("lists both roles in the vocabulary", () => {
    expect(NATIVE_AX_DROP_WHEN_BARE.has("sectionheader")).toBe(true);
    expect(NATIVE_AX_DROP_WHEN_BARE.has("sectionfooter")).toBe(true);
  });

  it.each(["sectionheader", "sectionfooter"])(
    "drops a bare %s and flattens its children",
    (role) => {
      expect(tree(role, {})).toBe(["main", '  heading "Title"'].join("\n"));
    },
  );

  it("drops one whose focusable property is false", () => {
    expect(
      tree("sectionheader", {
        properties: [{ name: "focusable", value: { value: false } }],
      }),
    ).toBe(["main", '  heading "Title"'].join("\n"));
  });

  it("keeps a named one", () => {
    expect(tree("sectionheader", { name: "Post meta" })).toBe(
      ["main", '  sectionheader "Post meta"', '    heading "Title"'].join("\n"),
    );
  });

  it("keeps a focusable one", () => {
    expect(
      tree("sectionfooter", {
        properties: [{ name: "focusable", value: { value: true } }],
      }),
    ).toBe(["main", "  sectionfooter", '    heading "Title"'].join("\n"));
  });

  it("does not let a dropped byline name the ancestor it flattened into", () => {
    const nodes = normalizeNativeAX([
      raw("1", "main", { childIds: ["2"] }),
      raw("2", "sectionheader", { parentId: "1", childIds: ["3"] }),
      raw("3", "StaticText", { parentId: "2", name: "By Ada" }),
    ]);
    expect(serializeNativeAX(nodes)).toBe("main");
  });

  it("keeps a busy one", () => {
    expect(
      tree("sectionheader", {
        properties: [{ name: "busy", value: { value: true } }],
      }),
    ).toBe(["main", "  sectionheader", '    heading "Title"'].join("\n"));
  });

  it("keeps one carrying an exposing ARIA property", () => {
    expect(
      tree("sectionheader", {
        properties: [{ name: "describedby", value: { value: [] } }],
      }),
    ).toBe(["main", "  sectionheader", '    heading "Title"'].join("\n"));
  });
});
