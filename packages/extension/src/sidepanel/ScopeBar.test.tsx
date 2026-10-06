import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, it, expect, afterEach, vi } from "vitest";

import { ScopeBar } from "./ScopeBar.js";

describe("ScopeBar", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  afterEach(() => render(null, container));

  function mount(onScope = vi.fn(), focusAfterExit?: () => HTMLElement) {
    act(() => {
      render(
        <ScopeBar
          focusAfterExit={focusAfterExit}
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

  it("hands focus to the caller's view after leaving the scope", () => {
    const view = document.createElement("div");
    view.tabIndex = 0;
    document.body.appendChild(view);
    mount(vi.fn(), () => view);
    act(() =>
      container.querySelector<HTMLButtonElement>(".sn-scope-exit")!.click(),
    );
    expect(document.activeElement).toBe(view);
    view.blur();
    act(() => crumb("document").click());
    expect(document.activeElement).toBe(view);
    view.remove();
  });

  it("hides the › separators from screen readers", () => {
    mount();
    const seps = container.querySelectorAll(".sn-breadcrumb-sep");
    expect(seps).toHaveLength(2);
    for (const sep of seps) {
      expect(sep.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
