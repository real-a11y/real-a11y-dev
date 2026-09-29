import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";

// In-memory stand-in for the Storybook preview channel so we can drive the
// preview-side event handlers registered at import time. Created via
// vi.hoisted so it exists before the (hoisted) vi.mock factory references it.
const { channel, observerState, extractorState } = vi.hoisted(() => {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    channel: {
      on: (event: string, cb: (...args: unknown[]) => void) => {
        const list = handlers.get(event) ?? [];
        list.push(cb);
        handlers.set(event, list);
      },
      emit: (event: string, ...args: unknown[]) => {
        for (const cb of handlers.get(event) ?? []) cb(...args);
      },
    },
    observerState: {
      constructed: 0,
      started: 0,
      stopped: 0,
      /** The debounced callback the live observer was constructed with. */
      fire: null as ((change?: unknown) => void) | null,
      reset() {
        this.constructed = 0;
        this.started = 0;
        this.stopped = 0;
        // Drop the callback too, so a test that fires before REQUEST_TREE
        // drives nothing rather than passing vacuously against a stale one.
        this.fire = null;
      },
    },
    extractorState: {
      constructed: 0,
      refreshCalls: 0,
      /**
       * Accessible name the mock extractor reports for the root node. Tests
       * change it to simulate a mutation that actually altered the tree, and
       * leave it alone to simulate one that did not.
       */
      rootName: "",
      reset() {
        this.constructed = 0;
        this.refreshCalls = 0;
        this.rootName = "";
      },
    },
  };
});

vi.mock("storybook/preview-api", () => ({
  addons: { getChannel: () => channel },
}));

vi.mock("@real-a11y-dev/core", () => {
  class DomObserver {
    constructor(
      _root: Element,
      cb: (change?: unknown) => void,
      _debounce: number,
    ) {
      observerState.constructed += 1;
      observerState.fire = cb;
    }
    start() {
      observerState.started += 1;
    }
    stop() {
      observerState.stopped += 1;
    }
  }

  class LiveTreeExtractor {
    constructor() {
      extractorState.constructed += 1;
    }
    refresh() {
      extractorState.refreshCalls += 1;
      // A fresh object graph every call, exactly like the real extractor: the
      // payloads are only ever equal by VALUE, never by identity.
      return {
        nodes: new Map([
          [
            "root",
            {
              id: "root",
              a11y: {
                role: "generic",
                name: extractorState.rootName,
                description: "",
                states: {},
                properties: {},
              },
              ui: {
                expanded: false,
                highlighted: false,
                matchesFilter: false,
                selected: false,
              },
            },
          ],
        ]),
        rootId: "root",
      };
    }
    setMode() {}
  }

  class FocusManager {
    destroy() {}
    highlightElement() {}
    clearHighlight() {}
  }

  class ActionDispatcher {
    dispatch() {}
  }

  return {
    DomObserver,
    LiveTreeExtractor,
    FocusManager,
    ActionDispatcher,
    getElementRefs: () => new WeakMap(),
  };
});

import type { TreeUpdatePayload } from "./constants.js";

let EVENTS: typeof import("./constants.js").EVENTS;

beforeAll(async () => {
  // Dynamic import so the bootstrap (which calls getChannel()) runs after the
  // mocked channel is in place and registers its handlers against it.
  await import("./preview.js");
  ({ EVENTS } = await import("./constants.js"));
});

beforeEach(() => {
  observerState.reset();
  extractorState.reset();
  // Ensure a clean stop between tests (panel closed).
  channel.emit(EVENTS.STOP_TREE);
  observerState.reset();
  extractorState.reset();
});

afterEach(() => {
  channel.emit(EVENTS.STOP_TREE);
});

describe("preview channel bootstrap", () => {
  it("does not throw when SET_MODE or REQUEST_TREE arrives before anything else", () => {
    expect(() => channel.emit(EVENTS.SET_MODE, "dom")).not.toThrow();
    expect(() => channel.emit(EVENTS.REQUEST_TREE)).not.toThrow();
  });

  it("does not start observing on storyRendered while the panel is closed", () => {
    channel.emit("storyRendered");
    expect(observerState.constructed).toBe(0);
    expect(extractorState.constructed).toBe(0);
  });

  it("starts observing on REQUEST_TREE and emits TREE_UPDATED once", () => {
    const updates: unknown[] = [];
    channel.on(EVENTS.TREE_UPDATED, (payload) => updates.push(payload));

    channel.emit(EVENTS.REQUEST_TREE);

    expect(observerState.started).toBe(1);
    expect(extractorState.constructed).toBe(1);
    expect(updates).toHaveLength(1);
  });

  it("stops observing on STOP_TREE so a later storyRendered stays idle", () => {
    channel.emit(EVENTS.REQUEST_TREE);
    expect(observerState.started).toBe(1);

    channel.emit(EVENTS.STOP_TREE);
    expect(observerState.stopped).toBe(1);

    observerState.reset();
    extractorState.reset();
    channel.emit("storyRendered");
    expect(observerState.constructed).toBe(0);
    expect(extractorState.constructed).toBe(0);
  });

  it("restarts the observer on storyRendered while the panel is open", () => {
    channel.emit(EVENTS.REQUEST_TREE);
    const startedAfterRequest = observerState.started;

    channel.emit("storyRendered");
    // stop() then start() — a new observer is constructed and started.
    expect(observerState.stopped).toBeGreaterThanOrEqual(1);
    expect(observerState.started).toBeGreaterThan(startedAfterRequest);
  });

  it("restarts after a simulated preview reload when REQUEST_TREE is re-sent", () => {
    // Manager stays mounted across an iframe reload; the reloaded preview
    // module has panelWantsTree === false until REQUEST_TREE arrives again
    // (manager listens for PREVIEW_READY and re-emits REQUEST_TREE).
    channel.emit(EVENTS.REQUEST_TREE);
    expect(observerState.started).toBe(1);

    // Simulate iframe teardown without manager STOP_TREE (module state lost).
    channel.emit(EVENTS.STOP_TREE);
    observerState.reset();
    extractorState.reset();

    channel.emit("storyRendered");
    expect(observerState.constructed).toBe(0);

    channel.emit(EVENTS.REQUEST_TREE);
    expect(observerState.started).toBe(1);
    expect(extractorState.constructed).toBe(1);
  });

  it("does not double-publish when REQUEST_TREE arrives while already running", () => {
    const updates: unknown[] = [];
    channel.on(EVENTS.TREE_UPDATED, (payload) => updates.push(payload));

    channel.emit(EVENTS.REQUEST_TREE);
    expect(updates).toHaveLength(1);

    channel.emit(EVENTS.REQUEST_TREE);
    expect(updates).toHaveLength(1);
    expect(observerState.started).toBe(1);
  });
});

describe("preview: redundant tree publishes", () => {
  /** Drive the observer's debounced callback the way a DOM mutation would. */
  function mutate() {
    observerState.fire?.({ full: false });
  }

  it("does not re-emit TREE_UPDATED when the extracted tree is unchanged", () => {
    const updates: unknown[] = [];
    channel.on(EVENTS.TREE_UPDATED, (payload) => updates.push(payload));

    channel.emit(EVENTS.REQUEST_TREE);
    expect(updates).toHaveLength(1);

    // Two mutations that extract to a byte-identical tree — an animation
    // frame rewriting inline `style`, a change inside an aria-hidden subtree.
    mutate();
    mutate();

    expect(updates).toHaveLength(1);
  });

  it("still re-extracts on every mutation so element refs stay fresh", () => {
    channel.emit(EVENTS.REQUEST_TREE);
    const afterStart = extractorState.refreshCalls;

    mutate();
    mutate();

    expect(extractorState.refreshCalls).toBe(afterStart + 2);
  });

  it("emits when the mutation actually changed the tree", () => {
    const updates: unknown[] = [];
    channel.on(EVENTS.TREE_UPDATED, (payload) => updates.push(payload));

    channel.emit(EVENTS.REQUEST_TREE);
    expect(updates).toHaveLength(1);

    extractorState.rootName = "Saved";
    mutate();
    expect(updates).toHaveLength(2);

    // …and goes quiet again once it stops changing.
    mutate();
    expect(updates).toHaveLength(2);
  });

  it("emits on SET_MODE even when the tree bytes are identical", () => {
    // `currentMode` is module state that outlives a single test, so pin the
    // starting mode rather than assuming the default. This publishes nothing
    // (no extractor yet).
    channel.emit(EVENTS.SET_MODE, "a11y");

    const updates: TreeUpdatePayload[] = [];
    channel.on(EVENTS.TREE_UPDATED, (payload) =>
      updates.push(payload as TreeUpdatePayload),
    );

    channel.emit(EVENTS.REQUEST_TREE);
    expect(updates).toHaveLength(1);

    channel.emit(EVENTS.SET_MODE, "dom");

    // The mock extractor returns the same nodes for either mode, but `mode`
    // is part of the payload — suppressing this would leave a listener
    // reading `payload.mode` on the mode the user just switched away from.
    expect(updates).toHaveLength(2);
    expect(updates[1]!.mode).toBe("dom");

    // Re-selecting the mode the panel is already in carries nothing new.
    channel.emit(EVENTS.SET_MODE, "dom");
    expect(updates).toHaveLength(2);
  });

  it("re-emits the first tree after a restart, unchanged or not", () => {
    const updates: unknown[] = [];
    channel.on(EVENTS.TREE_UPDATED, (payload) => updates.push(payload));

    channel.emit(EVENTS.REQUEST_TREE);
    expect(updates).toHaveLength(1);

    // A story render tears the extractor down and stands a new one up. The
    // manager may have remounted with no tree at all, so the first publish
    // after a restart must never be suppressed as a duplicate.
    channel.emit("storyRendered");

    expect(updates).toHaveLength(2);
  });
});
