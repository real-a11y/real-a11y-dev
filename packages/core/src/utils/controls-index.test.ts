import { describe, it, expect } from "vitest";

import type { SemanticNode } from "../types.js";

import { buildControlsIndex } from "./controls-index.js";

function makeNode(
  treeId: string,
  attrs: Record<string, string> = {},
  opts: { role?: string; isHidden?: boolean } = {},
): SemanticNode {
  return {
    id: treeId,
    parentId: null,
    childIds: [],
    depth: 0,
    dom: {
      tagName: "div",
      attributes: attrs,
      textContent: null,
      isHidden: opts.isHidden ?? false,
    },
    a11y: {
      role: opts.role ?? "generic",
      name: "",
      description: "",
      states: {},
      properties: {},
      isExposedToAT: true,
    },
    interaction: {
      isInteractive: false,
      actions: [],
      isFocusable: false,
      isEditable: false,
    },
    ui: {
      expanded: true,
      highlighted: false,
      matchesFilter: true,
      selected: false,
    },
  };
}

function tree(...entries: Array<[string, SemanticNode]>) {
  return new Map(entries);
}

describe("buildControlsIndex", () => {
  it("returns empty maps for an empty tree", () => {
    const { forward, reverse } = buildControlsIndex(new Map());
    expect(forward.size).toBe(0);
    expect(reverse.size).toBe(0);
  });

  it("ignores nodes without aria-controls", () => {
    const { forward, reverse } = buildControlsIndex(
      tree(["t1", makeNode("t1", { id: "menu" })]),
    );
    expect(forward.size).toBe(0);
    expect(reverse.size).toBe(0);
  });

  it("resolves aria-controls to the controlled element's tree id", () => {
    const { forward, reverse } = buildControlsIndex(
      tree(
        ["t1", makeNode("t1", { "aria-controls": "menu" })],
        ["t2", makeNode("t2", { id: "menu" })],
      ),
    );
    expect(forward.get("t1")).toEqual(["t2"]);
    expect(reverse.get("t2")).toEqual(["t1"]);
  });

  it("handles aria-controls with multiple space-separated ids", () => {
    const { forward, reverse } = buildControlsIndex(
      tree(
        ["t1", makeNode("t1", { "aria-controls": "panel-a panel-b" })],
        ["t2", makeNode("t2", { id: "panel-a" })],
        ["t3", makeNode("t3", { id: "panel-b" })],
      ),
    );
    expect(forward.get("t1")).toEqual(["t2", "t3"]);
    expect(reverse.get("t2")).toEqual(["t1"]);
    expect(reverse.get("t3")).toEqual(["t1"]);
  });

  it("collects multiple triggers pointing at the same element in reverse", () => {
    const { reverse } = buildControlsIndex(
      tree(
        ["t1", makeNode("t1", { "aria-controls": "panel" })],
        ["t2", makeNode("t2", { "aria-controls": "panel" })],
        ["t3", makeNode("t3", { id: "panel" })],
      ),
    );
    expect(reverse.get("t3")).toEqual(["t1", "t2"]);
  });

  it("drops references to dom ids not present in the tree", () => {
    const { forward, reverse } = buildControlsIndex(
      tree(["t1", makeNode("t1", { "aria-controls": "ghost" })]),
    );
    expect(forward.size).toBe(0);
    expect(reverse.size).toBe(0);
  });

  it("does not include the trigger in forward when none of its references resolve", () => {
    const { forward } = buildControlsIndex(
      tree(
        ["t1", makeNode("t1", { "aria-controls": "ghost-a ghost-b" })],
        ["t2", makeNode("t2", { id: "real" })],
      ),
    );
    expect(forward.has("t1")).toBe(false);
  });

  it("does not flag aria-controls links as inferred", () => {
    const { inferred } = buildControlsIndex(
      tree(
        ["t1", makeNode("t1", { "aria-controls": "menu" })],
        ["t2", makeNode("t2", { id: "menu" })],
      ),
    );
    expect(inferred.size).toBe(0);
  });

  describe("aria-haspopup heuristic", () => {
    it("links an expanded haspopup trigger to the next visible matching role", () => {
      // Drive's pattern: button[aria-haspopup="true"][aria-expanded="true"]
      // with no aria-controls; the menu sits later in the DOM.
      const { forward, reverse, inferred } = buildControlsIndex(
        tree(
          [
            "trigger",
            makeNode(
              "trigger",
              { "aria-haspopup": "true", "aria-expanded": "true" },
              { role: "button" },
            ),
          ],
          ["menu", makeNode("menu", {}, { role: "menu" })],
        ),
      );
      expect(forward.get("trigger")).toEqual(["menu"]);
      expect(reverse.get("menu")).toEqual(["trigger"]);
      expect(inferred.has("trigger")).toBe(true);
    });

    it("does not link when the trigger is collapsed", () => {
      const { forward, inferred } = buildControlsIndex(
        tree(
          [
            "trigger",
            makeNode(
              "trigger",
              { "aria-haspopup": "true", "aria-expanded": "false" },
              { role: "button" },
            ),
          ],
          ["menu", makeNode("menu", {}, { role: "menu" })],
        ),
      );
      expect(forward.size).toBe(0);
      expect(inferred.size).toBe(0);
    });

    it("does not link when the candidate menu is hidden", () => {
      const { forward } = buildControlsIndex(
        tree(
          [
            "trigger",
            makeNode(
              "trigger",
              { "aria-haspopup": "true", "aria-expanded": "true" },
              { role: "button" },
            ),
          ],
          ["menu", makeNode("menu", {}, { role: "menu", isHidden: true })],
        ),
      );
      expect(forward.size).toBe(0);
    });

    it("respects the haspopup value when picking the candidate role", () => {
      const { forward } = buildControlsIndex(
        tree(
          [
            "trigger",
            makeNode(
              "trigger",
              { "aria-haspopup": "listbox", "aria-expanded": "true" },
              { role: "combobox" },
            ),
          ],
          // A menu before the listbox should NOT be picked — wrong role.
          ["wrong", makeNode("wrong", {}, { role: "menu" })],
          ["right", makeNode("right", {}, { role: "listbox" })],
        ),
      );
      expect(forward.get("trigger")).toEqual(["right"]);
    });

    it("pairs multiple expanded triggers in DOM order with successive matching candidates", () => {
      const { forward, inferred } = buildControlsIndex(
        tree(
          [
            "t1",
            makeNode(
              "t1",
              { "aria-haspopup": "true", "aria-expanded": "true" },
              { role: "button" },
            ),
          ],
          ["m1", makeNode("m1", {}, { role: "menu" })],
          [
            "t2",
            makeNode(
              "t2",
              { "aria-haspopup": "true", "aria-expanded": "true" },
              { role: "button" },
            ),
          ],
          ["m2", makeNode("m2", {}, { role: "menu" })],
        ),
      );
      expect(forward.get("t1")).toEqual(["m1"]);
      expect(forward.get("t2")).toEqual(["m2"]);
      expect(inferred.has("t1")).toBe(true);
      expect(inferred.has("t2")).toBe(true);
    });

    it("does not poach an element already controlled by an explicit aria-controls link", () => {
      // First trigger has aria-controls="menu" — claims it explicitly.
      // Second trigger is a heuristic candidate but the menu is taken.
      const { forward, inferred } = buildControlsIndex(
        tree(
          ["t1", makeNode("t1", { "aria-controls": "menu" })],
          ["menu", makeNode("menu", { id: "menu" }, { role: "menu" })],
          [
            "t2",
            makeNode(
              "t2",
              { "aria-haspopup": "true", "aria-expanded": "true" },
              { role: "button" },
            ),
          ],
        ),
      );
      expect(forward.get("t1")).toEqual(["menu"]);
      expect(forward.has("t2")).toBe(false);
      expect(inferred.size).toBe(0);
    });

    it("does not double-link a trigger that already has aria-controls", () => {
      // Trigger has BOTH aria-controls and the heuristic shape — explicit
      // wins, heuristic is skipped, nothing is marked inferred.
      const { forward, inferred } = buildControlsIndex(
        tree(
          [
            "t1",
            makeNode("t1", {
              "aria-controls": "panel",
              "aria-haspopup": "true",
              "aria-expanded": "true",
            }),
          ],
          ["panel", makeNode("panel", { id: "panel" }, { role: "menu" })],
        ),
      );
      expect(forward.get("t1")).toEqual(["panel"]);
      expect(inferred.size).toBe(0);
    });
  });
});
