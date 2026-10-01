import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, it, expect, afterEach } from "vitest";

import { SemanticNavigator, useSemanticTree, useActiveModal } from "./index.js";

afterEach(() => cleanup());

// Wait on the condition, never on a fixed sleep. The panel's tree renders only
// after Preact's deferred effect chain (next frame, or its 35ms fallback
// timer), and the hooks re-extract on a 300ms debounce — so a sleep sized to
// an idle machine loses the race under a loaded `pnpm verify`. Generous on
// purpose: `waitFor` returns as soon as the condition holds.
const WAIT = { timeout: 3000 };

/**
 * Polls the navigator's shadow root until `selector` matches, and returns the
 * match. Until the tree has been extracted the panel shows only an
 * "Extracting tree…" placeholder, so nothing inside the toolbar exists yet.
 */
function findInPanel(host: Element, selector: string): Promise<Element> {
  return waitFor(() => {
    const el = host.shadowRoot?.querySelector(selector) ?? null;
    expect(el).not.toBeNull();
    return el!;
  }, WAIT);
}

function Harness({
  html,
  child,
}: {
  html: string;
  child?: (ref: React.RefObject<HTMLDivElement | null>) => React.ReactNode;
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
    // The host div is the second div in the container.
    const host = container.querySelectorAll("div")[1];
    expect(host).toBeDefined();
    // Shadow DOM should be attached (mode: "shadow" is the default).
    await waitFor(() => expect(host.shadowRoot).not.toBeNull(), WAIT);
  });

  it("renders the picker toolbar button only when enablePicker is true", async () => {
    function App({ enablePicker }: { enablePicker: boolean }) {
      const rootRef = useRef<HTMLDivElement>(null);
      return (
        <>
          <div ref={rootRef}>
            <button>Go</button>
          </div>
          <SemanticNavigator root={rootRef} enablePicker={enablePicker} />
        </>
      );
    }

    // enablePicker={false} (default) → no picker button. Wait for the toolbar
    // first: before it renders the button is absent whatever the prop says.
    const off = render(<App enablePicker={false} />);
    const offHost = off.container.querySelectorAll("div")[1];
    const offToolbar = await findInPanel(offHost, ".sn-toolbar");
    expect(offToolbar.querySelector(".sn-pick-btn")).toBeNull();
    off.unmount();

    // enablePicker={true} → picker button rendered with aria-pressed="false"
    const on = render(<App enablePicker={true} />);
    const onHost = on.container.querySelectorAll("div")[1];
    const pickBtn = await findInPanel(onHost, ".sn-pick-btn");
    expect(pickBtn.getAttribute("aria-pressed")).toBe("false");
    expect(pickBtn.getAttribute("aria-label")).toBe("Pick element in page");
  });

  it("picks up enablePicker toggled after mount", async () => {
    // Regression: config flags used to be frozen in the createInspector effect
    // (deps were only root/mount/host), so flipping enablePicker at runtime
    // silently did nothing.
    function App() {
      const rootRef = useRef<HTMLDivElement>(null);
      const [enablePicker, setEnablePicker] = useState(false);
      return (
        <>
          <div ref={rootRef}>
            <button>Go</button>
          </div>
          <button type="button" onClick={() => setEnablePicker(true)}>
            enable picker
          </button>
          <SemanticNavigator root={rootRef} enablePicker={enablePicker} />
        </>
      );
    }

    const { container, getByText } = render(<App />);
    const host = container.querySelectorAll("div")[1];
    // Absent from a toolbar that has rendered — not merely from the
    // "Extracting tree…" placeholder, where it would be absent regardless.
    const toolbar = await findInPanel(host, ".sn-toolbar");
    expect(toolbar.querySelector(".sn-pick-btn")).toBeNull();

    await act(async () => {
      getByText("enable picker").click();
    });
    // Rejects if the button never appears, which is what the regression did.
    await findInPanel(host, ".sn-pick-btn");
  });

  it("invokes the latest onNodeSelect after the parent recreates the callback", async () => {
    // Regression: onNodeSelect was closed over at mount, so a parent that
    // recreates the callback to capture new state kept invoking the stale one.
    const seen: string[] = [];
    function App() {
      const rootRef = useRef<HTMLDivElement>(null);
      const [tag, setTag] = useState("v1");
      return (
        <>
          <div ref={rootRef}>
            <button>Go</button>
          </div>
          <button type="button" onClick={() => setTag("v2")}>
            bump
          </button>
          <SemanticNavigator
            root={rootRef}
            onNodeSelect={() => {
              seen.push(tag);
            }}
          />
        </>
      );
    }

    const { container, getByText } = render(<App />);
    const host = container.querySelectorAll("div")[1];
    await findInPanel(host, '[role="treeitem"]');

    const clickFirstRow = () => {
      const row =
        host.shadowRoot?.querySelector<HTMLElement>('[role="treeitem"]');
      expect(row).not.toBeNull();
      row!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    };

    await act(async () => {
      clickFirstRow();
    });
    expect(seen).toEqual(["v1"]);

    await act(async () => {
      getByText("bump").click();
    });
    await act(async () => {
      clickFirstRow();
    });
    expect(seen).toEqual(["v1", "v2"]);
  });

  it("attaches the inspector in floating mode when the root is already set on first render", async () => {
    // The common `{open && <SemanticNavigator floating />}` pattern: by the time
    // the navigator first renders, `root.current` is ALREADY populated, and the
    // floating host lives in a portal that only appears on a later commit. The
    // panel used to render its title-bar chrome with an empty body because the
    // create-inspector effect never re-ran once the host existed.
    function App() {
      const rootRef = useRef<HTMLDivElement>(null);
      const [open, setOpen] = useState(false);
      return (
        <>
          <div ref={rootRef}>
            <button>Go</button>
          </div>
          <button onClick={() => setOpen(true)}>Open panel</button>
          {open && <SemanticNavigator root={rootRef} floating />}
        </>
      );
    }

    const { getByText } = render(<App />);
    // First commit populates rootRef; now toggle the navigator on.
    await act(async () => {
      getByText("Open panel").click();
    });

    // The floating panel portals into document.body — its host div must have a
    // shadow root, i.e. the inspector actually mounted.
    await waitFor(() => {
      const mounted = Array.from(document.body.querySelectorAll("div")).some(
        (d) => d.shadowRoot !== null,
      );
      expect(mounted).toBe(true);
    }, WAIT);
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
    // Wait for the effect + first flush.
    await waitFor(() => expect(latest).not.toBeNull(), WAIT);
    const initialButtons = Array.from(latest!.nodes.values()).filter(
      (n) => n.a11y.role === "button",
    );
    expect(initialButtons).toHaveLength(1);

    // Mutate: append a second button, wait for the debounced observer.
    await act(async () => {
      const newBtn = document.createElement("button");
      newBtn.textContent = "Second";
      container.firstElementChild!.appendChild(newBtn);
    });

    await waitFor(() => {
      const afterButtons = Array.from(latest!.nodes.values()).filter(
        (n) => n.a11y.role === "button",
      );
      expect(afterButtons.length).toBeGreaterThanOrEqual(2);
    }, WAIT);
  });

  it("attaches to a root that mounts after the first commit", async () => {
    // Data-gated / conditional UI: the root doesn't exist on first render.
    // Passing the ELEMENT (via a callback ref in state) lets the hook re-attach
    // when it appears — a stable ref object cannot signal that.
    let latest: ReturnType<typeof useSemanticTree> = null;
    function Subject() {
      const [root, setRoot] = useState<HTMLDivElement | null>(null);
      const [show, setShow] = useState(false);
      latest = useSemanticTree(root);
      return (
        <>
          <button onClick={() => setShow(true)}>show</button>
          {show && (
            <div ref={setRoot}>
              <button>Late</button>
            </div>
          )}
        </>
      );
    }

    const { getByText } = render(<Subject />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(latest).toBeNull(); // nothing to observe yet

    await act(async () => {
      getByText("show").click();
    });
    await waitFor(() => {
      expect(latest).not.toBeNull();
      const names = Array.from(latest!.nodes.values()).map((n) => n.a11y.name);
      expect(names).toContain("Late");
    }, WAIT);
  });

  it("re-attaches when the root element is replaced", async () => {
    // A `key` change swaps the DOM node. The observer must move to the new
    // element instead of continuing to watch the detached one.
    let latest: ReturnType<typeof useSemanticTree> = null;
    function Subject() {
      const [root, setRoot] = useState<HTMLDivElement | null>(null);
      const [k, setK] = useState(0);
      latest = useSemanticTree(root);
      return (
        <>
          <button onClick={() => setK(1)}>swap</button>
          <div key={k} ref={setRoot}>
            <button>{k === 0 ? "First" : "Second"}</button>
          </div>
        </>
      );
    }

    const { getByText } = render(<Subject />);
    await waitFor(() => {
      expect(latest).not.toBeNull();
      expect(
        Array.from(latest!.nodes.values()).map((n) => n.a11y.name),
      ).toContain("First");
    }, WAIT);

    await act(async () => {
      getByText("swap").click();
    });
    await waitFor(() => {
      expect(
        Array.from(latest!.nodes.values()).map((n) => n.a11y.name),
      ).toContain("Second");
    }, WAIT);
  });

  it("clears the tree when the observed root is removed", async () => {
    // The store's tree is only written by the observer's flush, so tearing the
    // observer down must also drop it — otherwise consumers keep being served
    // a tree describing content that is no longer on the page.
    let latest: ReturnType<typeof useSemanticTree> = null;
    function Subject() {
      const [root, setRoot] = useState<HTMLDivElement | null>(null);
      const [show, setShow] = useState(true);
      latest = useSemanticTree(root);
      return (
        <>
          <button onClick={() => setShow(false)}>hide</button>
          {show && (
            <div ref={setRoot}>
              <button>Inside</button>
            </div>
          )}
        </>
      );
    }

    const { getByText } = render(<Subject />);
    await waitFor(() => expect(latest).not.toBeNull(), WAIT);

    await act(async () => {
      getByText("hide").click();
    });
    await waitFor(() => expect(latest).toBeNull(), WAIT);
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
    });
    // The observer re-extracts after its 300ms debounce.
    await waitFor(() => expect(latest?.a11y.name).toBe("Confirm"), WAIT);
  });

  it("stops reporting a dialog once its root is removed", async () => {
    // App code that reacts to modal presence must not keep believing a dialog
    // is open after the element holding it has been unmounted.
    let latest: ReturnType<typeof useActiveModal> = null;
    function Subject() {
      const [root, setRoot] = useState<HTMLDivElement | null>(null);
      const [show, setShow] = useState(true);
      latest = useActiveModal(root);
      return (
        <>
          <button onClick={() => setShow(false)}>hide</button>
          {show && (
            <div ref={setRoot}>
              <div role="dialog" aria-label="Confirm" />
            </div>
          )}
        </>
      );
    }

    const { getByText } = render(<Subject />);
    await waitFor(() => expect(latest?.a11y.name).toBe("Confirm"), WAIT);

    await act(async () => {
      getByText("hide").click();
    });
    await waitFor(() => expect(latest).toBeNull(), WAIT);
  });
});

// Silence "unused import" lints from Harness when not used
void Harness;
