import { describe, it, expect, vi } from "vitest";

import {
  arrowLeftStopsAtScopeRoot,
  describeNode,
  handleListScopeKey,
  hasChildren,
  isInScope,
  matchCountLabel,
  scopeKeyAction,
  scopePath,
  subtreeNodes,
} from "./scope.js";

const PARENT: Record<string, string | undefined> = {
  form: "main",
  main: "root",
  field: "form",
};
const parentOf = (id: string) => PARENT[id];

describe("scopePath", () => {
  it("walks from the scoped node up to the root, root first", () => {
    expect(scopePath("form", parentOf, (id) => id.toUpperCase())).toEqual([
      { id: "root", label: "ROOT" },
      { id: "main", label: "MAIN" },
      { id: "form", label: "FORM" },
    ]);
  });

  it("stops at the first node it can't label", () => {
    expect(
      scopePath("form", parentOf, (id) => (id === "root" ? undefined : id)),
    ).toEqual([
      { id: "main", label: "main" },
      { id: "form", label: "form" },
    ]);
  });
});

describe("isInScope", () => {
  it("is true for the scope root itself and anything under it", () => {
    expect(isInScope("form", "form", parentOf)).toBe(true);
    expect(isInScope("field", "form", parentOf)).toBe(true);
  });

  it("is false for an ancestor or an unrelated node", () => {
    expect(isInScope("main", "form", parentOf)).toBe(false);
    expect(isInScope("other", "form", parentOf)).toBe(false);
  });
});

describe("subtreeNodes", () => {
  it("keeps the root and everything under it, nothing else", () => {
    const nodes = new Map([
      ["root", { childIds: ["a", "b"] }],
      ["a", { childIds: ["a1"] }],
      ["a1", { childIds: [] }],
      ["b", {}],
    ]);
    expect([...subtreeNodes(nodes, "a").keys()].sort()).toEqual(["a", "a1"]);
    expect(subtreeNodes(nodes, "gone").size).toBe(0);
  });
});

describe("scopeKeyAction", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("scopes on Ctrl+Enter and Cmd+Enter", () => {
    const state = { scoped: false, pickArmed: false };
    expect(scopeKeyAction(key({ key: "Enter", ctrlKey: true }), state)).toBe(
      "scope",
    );
    expect(scopeKeyAction(key({ key: "Enter", metaKey: true }), state)).toBe(
      "scope",
    );
  });

  it("leaves plain and Shift+Enter alone — they activate and step", () => {
    const state = { scoped: true, pickArmed: false };
    expect(scopeKeyAction(key({ key: "Enter" }), state)).toBeNull();
    expect(
      scopeKeyAction(key({ key: "Enter", shiftKey: true }), state),
    ).toBeNull();
  });

  it("exits on Escape only while scoped", () => {
    expect(
      scopeKeyAction(key({ key: "Escape" }), {
        scoped: true,
        pickArmed: false,
      }),
    ).toBe("exit");
    expect(
      scopeKeyAction(key({ key: "Escape" }), {
        scoped: false,
        pickArmed: false,
      }),
    ).toBeNull();
  });

  it("leaves Escape to an armed pick", () => {
    expect(
      scopeKeyAction(key({ key: "Escape" }), { scoped: true, pickArmed: true }),
    ).toBeNull();
  });
});

describe("handleListScopeKey", () => {
  const key = (init: KeyboardEventInit) =>
    new KeyboardEvent("keydown", { ...init, cancelable: true });

  it("leaves the scope on Escape", () => {
    const onExitScope = vi.fn();
    const e = key({ key: "Escape" });
    expect(handleListScopeKey(e, { scoped: true, onExitScope })).toBe(true);
    expect(onExitScope).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(true);
  });

  it("consumes Ctrl/Cmd+Enter so it never reaches plain Enter's activate", () => {
    const onExitScope = vi.fn();
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      const e = key({ key: "Enter", ...mod });
      expect(handleListScopeKey(e, { scoped: false, onExitScope })).toBe(true);
      expect(e.defaultPrevented).toBe(true);
    }
    expect(onExitScope).not.toHaveBeenCalled();
  });

  it("leaves Escape alone when unscoped, with no exit, or with a pick armed", () => {
    const onExitScope = vi.fn();
    expect(
      handleListScopeKey(key({ key: "Escape" }), {
        scoped: false,
        onExitScope,
      }),
    ).toBe(false);
    expect(handleListScopeKey(key({ key: "Escape" }), { scoped: true })).toBe(
      false,
    );
    expect(
      handleListScopeKey(key({ key: "Escape" }), {
        scoped: true,
        pickArmed: true,
        onExitScope,
      }),
    ).toBe(false);
    expect(onExitScope).not.toHaveBeenCalled();
  });

  it("leaves plain Enter to the list", () => {
    expect(handleListScopeKey(key({ key: "Enter" }), { scoped: true })).toBe(
      false,
    );
  });
});

describe("shared labels and guards", () => {
  it("describes a node as role and quoted name, or the bare role", () => {
    expect(describeNode("region", "Items")).toBe('region "Items"');
    expect(describeNode("generic", "")).toBe("generic");
    expect(describeNode("list", undefined)).toBe("list");
  });

  it("counts matches, saying when only the scope is counted", () => {
    expect(matchCountLabel(1, false)).toBe("1 match");
    expect(matchCountLabel(0, true)).toBe("0 matches in this scope");
    expect(matchCountLabel(3, false)).toBe("3 matches");
  });

  it("knows which rows have children", () => {
    expect(hasChildren({ childIds: ["a"] })).toBe(true);
    expect(hasChildren({ childIds: [] })).toBe(false);
    expect(hasChildren({})).toBe(false);
    expect(hasChildren(undefined)).toBe(false);
  });

  it("stops ArrowLeft only on a closed scope root", () => {
    expect(arrowLeftStopsAtScopeRoot("s", "s", false)).toBe(true);
    expect(arrowLeftStopsAtScopeRoot("s", "s", true)).toBe(false);
    expect(arrowLeftStopsAtScopeRoot("c", "s", false)).toBe(false);
    expect(arrowLeftStopsAtScopeRoot("s", null, false)).toBe(false);
  });
});
