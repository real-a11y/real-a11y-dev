import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { describe, it, expect, afterEach } from "vitest";

import { SemanticNavigator, useSemanticTree, useActiveModal } from "./index.js";

afterEach(() => cleanup());

function Harness({
  html,
  child,
}: {
  html: string;
  child?: (ref: React.RefObject<HTMLDivElement>) => React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div
        ref={rootRef}
        data-testid="page-root"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {child?.(rootRef)}
    </>
  );
}

describe("<SemanticNavigator />", () => {
  it("mounts and attaches a shadow root to its host div", async () => {
    function App() {
      const rootRef = useRef<HTMLDivElement>(null);
      return (
        <>
          <div ref={rootRef}>
            <button>Go</button>
          </div>
          {/* Pass the ref object directly — the component reads .current after commit */}
          <SemanticNavigator root={rootRef} />
        </>
      );
    }
    const { container } = render(<App />);
    // Wait for the effect to run and the shadow root to be attached.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // The host div is the second div in the container.
    const host = container.querySelectorAll("div")[1];
    expect(host).toBeDefined();
    // Shadow DOM should be attached (mode: "shadow" is the default).
    expect(host.shadowRoot).not.toBeNull();
  });
});

describe("useSemanticTree", () => {
  it("returns a tree and updates after a DOM mutation", async () => {
    let latest: ReturnType<typeof useSemanticTree> = null;

    function Subject() {
      const ref = useRef<HTMLDivElement>(null);
      latest = useSemanticTree(ref);
      return (
        <div ref={ref}>
          <button>First</button>
        </div>
      );
    }

    const { container } = render(<Subject />);
    // Wait a tick for the effect + first flush.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(latest).not.toBeNull();
    const initialButtons = Array.from(latest!.nodes.values()).filter(
      (n) => n.a11y.role === "button",
    );
    expect(initialButtons).toHaveLength(1);

    // Mutate: append a second button, wait for the debounced observer.
    await act(async () => {
      const newBtn = document.createElement("button");
      newBtn.textContent = "Second";
      container.firstElementChild!.appendChild(newBtn);
      await new Promise((r) => setTimeout(r, 400));
    });

    const afterButtons = Array.from(latest!.nodes.values()).filter(
      (n) => n.a11y.role === "button",
    );
    expect(afterButtons.length).toBeGreaterThanOrEqual(2);
  });
});

describe("useActiveModal", () => {
  it("returns null when no dialog is open and the dialog once it appears", async () => {
    let latest: ReturnType<typeof useActiveModal> = null;
    function Subject() {
      const ref = useRef<HTMLDivElement>(null);
      latest = useActiveModal(ref);
      return <div ref={ref} />;
    }
    const { container } = render(<Subject />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(latest).toBeNull();

    await act(async () => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-label", "Confirm");
      container.firstElementChild!.appendChild(dialog);
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(latest?.a11y.name).toBe("Confirm");
  });
});

// Silence "unused import" lints from Harness when not used
void Harness;
