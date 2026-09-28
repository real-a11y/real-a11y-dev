import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, afterEach, vi } from "vitest";

import { isInScope, ScopeBar, scopeKeyAction, scopePath } from "./ScopeBar.js";

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

describe("ScopeBar", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  afterEach(() => render(null, container));

  function mount(onScope = vi.fn()) {
    act(() => {
      render(
        <ScopeBar
          path={[
            { id: "root", label: "document" },
            { id: "main", label: "main" },
            { id: "form", label: 'form "Add a comment"' },
          ]}
          rootId="root"
          onScope={onScope}
        />,
        container,
      );
    });
    return onScope;
  }

  function crumb(label: string): HTMLButtonElement {
    const btn = [
      ...container.querySelectorAll<HTMLButtonElement>(".sn-breadcrumb-item"),
    ].find((b) => b.textContent === label);
    if (!btn) throw new Error(`no crumb ${label}`);
    return btn;
  }

  it("exits the scope from the ✕ and from the root crumb", () => {
    const onScope = mount();
    act(() =>
      container.querySelector<HTMLButtonElement>(".sn-scope-exit")!.click(),
    );
    act(() => crumb("document").click());
    expect(onScope.mock.calls).toEqual([[null], [null]]);
  });

  it("re-scopes to an ancestor crumb, and ignores the current one", () => {
    const onScope = mount();
    act(() => crumb('form "Add a comment"').click());
    act(() => crumb("main").click());
    expect(onScope.mock.calls).toEqual([["main"]]);
  });

  it("marks the scoped node as the current location", () => {
    mount();
    expect(crumb('form "Add a comment"').getAttribute("aria-current")).toBe(
      "location",
    );
    expect(crumb("main").hasAttribute("aria-current")).toBe(false);
  });
});
