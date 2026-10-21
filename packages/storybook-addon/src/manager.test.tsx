import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";

import { EVENTS, PANEL_ID } from "./constants.js";

// In-memory stand-ins for the manager channel, the panels Storybook registers,
// and the ResizeObserver the panel reads its own visibility from. Created via
// vi.hoisted so they exist before the (hoisted) vi.mock factories run.
const sb = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  const listeners = new Map<string, Set<Listener>>();
  return {
    /** Every event put on the channel, from either side, in order. */
    emitted: [] as { event: string; args: unknown[] }[],
    /** Panels registered through `addons.add`, by id. */
    panels: new Map<
      string,
      { render: (props: { active?: boolean }) => React.ReactElement | null }
    >(),
    channel: {
      on(event: string, cb: Listener) {
        const set = listeners.get(event) ?? new Set();
        set.add(cb);
        listeners.set(event, set);
      },
      off(event: string, cb: Listener) {
        listeners.get(event)?.delete(cb);
      },
      emit(event: string, ...args: unknown[]) {
        sb.emitted.push({ event, args });
        for (const cb of listeners.get(event) ?? []) cb(...args);
      },
    },
  };
});

vi.mock("storybook/manager-api", () => ({
  addons: {
    register: (_id: string, cb: () => void) => cb(),
    add: (
      id: string,
      config: {
        render: (props: { active?: boolean }) => React.ReactElement | null;
      },
    ) => sb.panels.set(id, config),
    getChannel: () => sb.channel,
  },
  types: { PANEL: "panel" },
}));

// The real TreePanel is a Preact app; what these tests are about is when the
// panel asks for a tree and in which mode, so it only records its props.
const ui = vi.hoisted(() => ({
  props: null as null | {
    treeData: unknown;
    viewMode: string;
    onViewModeChange: (mode: string) => void;
  },
  preserveExpandedState: vi.fn(),
}));

vi.mock("@real-a11y-dev/semantic-navigator-ui", () => ({
  TreePanel: (props: NonNullable<typeof ui.props>) => {
    ui.props = props;
    return null;
  },
  preserveExpandedState: ui.preserveExpandedState,
}));

/** Live fake ResizeObservers; `resize()` reports a new box to each of them. */
const observers = new Set<{ cb: ResizeObserverCallback }>();

class FakeResizeObserver {
  constructor(public cb: ResizeObserverCallback) {}
  observe() {
    observers.add(this);
  }
  unobserve() {}
  disconnect() {
    observers.delete(this);
  }
}

/** Storybook laying the panel out at `width` × `height` (0 when it hides it). */
async function resize(width: number, height: number) {
  await act(async () => {
    for (const o of [...observers]) {
      o.cb(
        [{ contentRect: { width, height } } as ResizeObserverEntry],
        o as unknown as ResizeObserver,
      );
    }
  });
}

/** A minimal TREE_UPDATED payload, as the preview would send it. */
function treeUpdate(mode = "a11y") {
  return {
    tree: {
      nodes: [["n1", { id: "n1", a11y: { role: "button", name: "Go" } }]],
      rootId: "n1",
    },
    mode,
    extractedAt: 0,
  };
}

/** The manager → preview requests on the channel since the last `clear()`. */
function requests() {
  const short = (event: string) => event.split("/").pop();
  return sb.emitted
    .filter(({ event }) =>
      [EVENTS.SET_MODE, EVENTS.REQUEST_TREE, EVENTS.STOP_TREE].includes(
        event as never,
      ),
    )
    .map(({ event, args }) =>
      args[0] === undefined
        ? short(event)
        : `${short(event)}:${String(args[0])}`,
    );
}

function clear() {
  sb.emitted.length = 0;
}

let host: HTMLDivElement;
let root: Root;

/** Renders the registered panel the way Storybook does. */
async function renderPanel(active = true) {
  const panel = sb.panels.get(PANEL_ID);
  if (!panel) throw new Error("panel not registered");
  await act(async () => {
    root.render(panel.render({ active }));
  });
}

async function fromPreview(event: string, payload?: unknown) {
  await act(async () => sb.channel.emit(event, payload));
}

/** The panel's own container, if it is mounted. */
function container(): HTMLElement | null {
  return host.querySelector("div");
}

beforeAll(async () => {
  await import("./manager.js");
});

beforeEach(() => {
  sb.emitted.length = 0;
  observers.clear();
  ui.props = null;
  ui.preserveExpandedState.mockClear();
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("__SN_STYLES__", "");
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("panel visibility", () => {
  // Storybook 10.1+ renders every addon panel at once with `active: true` and
  // `display: none` on the unselected ones, so visibility is the box's area.
  it("asks for a tree only while the panel has an area", async () => {
    await renderPanel(true);
    expect(container()).not.toBeNull();
    expect(requests()).toEqual([]);

    await resize(600, 300);
    expect(requests()).toEqual(["request-tree:a11y"]);

    clear();
    await resize(0, 0);
    expect(requests()).toEqual(["stop-tree"]);

    // Storybook 9 collapses a bottom panel to zero height at full width.
    clear();
    await resize(1100, 0);
    expect(requests()).toEqual([]);

    await resize(600, 300);
    expect(requests()).toEqual(["request-tree:a11y"]);
  });

  it("keeps its tree and expansion while hidden", async () => {
    await renderPanel(true);
    await resize(600, 300);
    await fromPreview(EVENTS.TREE_UPDATED, treeUpdate());
    const first = ui.props!.treeData;

    await resize(0, 0);
    await resize(600, 300);
    // Still mounted, so still showing the last tree until the fresh one lands…
    expect(ui.props!.treeData).toBe(first);

    await fromPreview(EVENTS.TREE_UPDATED, treeUpdate());
    // …which inherits the rows collapsed in it.
    expect(ui.preserveExpandedState).toHaveBeenLastCalledWith(
      first,
      ui.props!.treeData,
    );
  });

  it("leaves a reloaded preview idle while hidden", async () => {
    await renderPanel(true);
    await resize(600, 300);
    await resize(0, 0);
    clear();
    await fromPreview(EVENTS.PREVIEW_READY);
    expect(requests()).toEqual([]);
  });

  // Storybook 9 unmounts an unselected panel instead.
  it("stops when Storybook unmounts it", async () => {
    await renderPanel(true);
    await resize(600, 300);
    clear();
    await renderPanel(false);
    expect(requests()).toEqual(["stop-tree"]);
  });

  it("renders nothing for an inactive panel", async () => {
    await renderPanel(false);
    expect(container()).toBeNull();
    expect(requests()).toEqual([]);
  });

  it("fills its tab panel in flow rather than over the tab bar", async () => {
    await renderPanel(true);
    const style = container()!.style;
    expect(style.position).toBe("relative");
    expect(style.height).toBe("100%");
  });
});

describe("extraction mode", () => {
  async function openWithTree() {
    await renderPanel(true);
    await resize(600, 300);
    await fromPreview(EVENTS.TREE_UPDATED, treeUpdate());
    expect(ui.props?.viewMode).toBe("a11y");
  }

  it("asks for the tree in the mode the panel is showing", async () => {
    await openWithTree();
    clear();
    await act(async () => ui.props!.onViewModeChange("dom"));
    expect(requests()).toEqual(["set-mode:dom"]);

    clear();
    await resize(0, 0);
    await resize(600, 300);
    expect(requests()).toEqual(["stop-tree", "request-tree:dom"]);
    expect(ui.props?.viewMode).toBe("dom");
  });

  it("keeps the tab view on the extraction it was showing", async () => {
    await openWithTree();
    await act(async () => ui.props!.onViewModeChange("dom"));
    clear();
    await act(async () => ui.props!.onViewModeChange("tab"));
    // "tab" is a client-side view of the current tree: nothing to re-extract.
    expect(requests()).toEqual([]);

    await resize(0, 0);
    await resize(600, 300);
    expect(requests()).toEqual(["stop-tree", "request-tree:dom"]);
    expect(ui.props?.viewMode).toBe("tab");
  });

  it("re-requests in its mode when a reloaded preview announces itself", async () => {
    await openWithTree();
    await act(async () => ui.props!.onViewModeChange("dom"));
    clear();
    // A canvas reload re-runs the preview module, whose mode starts at "a11y".
    await fromPreview(EVENTS.PREVIEW_READY);
    expect(requests()).toEqual(["request-tree:dom"]);
  });
});
