import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Every root the navigator builds an inspector on, in order. createInspector
// is wrapped, not replaced: the real one still runs, so the panel behaves as
// it does in react.test.tsx. In its own file because the mock is per module.
const builds = vi.hoisted((): Element[] => []);

vi.mock("@real-a11y-dev/inspector", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@real-a11y-dev/inspector")>();
  return {
    ...actual,
    createInspector: (
      options: Parameters<typeof actual.createInspector>[0],
    ) => {
      builds.push(options.root);
      return actual.createInspector(options);
    },
  };
});

import { SemanticNavigator } from "./index.js";

afterEach(() => {
  cleanup();
  builds.length = 0;
});

describe("<SemanticNavigator /> builds", () => {
  it("builds once on the new root when the root element and theme change together", async () => {
    // An element root is a plain prop, so it is current in the same render as
    // the theme. Kept in state after a commit, it lagged one commit behind:
    // the theme change rebuilt the panel on the old root, then the root
    // change rebuilt it again.
    const first = document.createElement("main");
    first.innerHTML = "<h1>First</h1>";
    const second = document.createElement("main");
    second.innerHTML = "<h1>Second</h1>";
    document.body.append(first, second);

    try {
      const { rerender } = render(
        <SemanticNavigator root={first} theme="light" />,
      );
      await waitFor(() => expect(builds).toEqual([first]));

      rerender(<SemanticNavigator root={second} theme="dark" />);
      await waitFor(() => expect(builds.at(-1)).toBe(second));
      // Let any follow-up commit run before counting.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(builds).toEqual([first, second]);
    } finally {
      first.remove();
      second.remove();
    }
  });
});
