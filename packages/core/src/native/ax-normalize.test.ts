// Tests run against a RECORDED `Accessibility.getFullAXTree` payload
// (__fixtures__/ax-media-form.json, captured from Chromium 141 on a fixture
// page with media + form + list + presentational wrappers) — no browser in
// the loop, which is the point: the vocabulary is pure and testable offline.

import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/ax-media-form.json";
import {
  normalizeNativeAX,
  serializeNativeAX,
  type NativeAXNode,
  type RawNativeAXNode,
} from "./ax-normalize.js";
import {
  mapNativeAXRole,
  NATIVE_AX_DROP_ROLES,
  NATIVE_AX_VOCABULARY_VERSION,
} from "./ax-vocabulary.js";

const rawNodes = fixture.nodes as RawNativeAXNode[];

function byRole(nodes: NativeAXNode[], role: string): NativeAXNode[] {
  return nodes.filter((n) => n.role === role);
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
  const raw = (
    nodeId: string,
    role: string,
    opts: { parentId?: string; childIds?: string[]; name?: string } = {},
  ): RawNativeAXNode => ({
    nodeId,
    role: { value: role },
    ...(opts.name !== undefined ? { name: { value: opts.name } } : {}),
    ...(opts.parentId !== undefined ? { parentId: opts.parentId } : {}),
    ...(opts.childIds !== undefined ? { childIds: opts.childIds } : {}),
  });

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
