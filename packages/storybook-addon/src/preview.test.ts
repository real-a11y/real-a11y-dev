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
      reset() {
        this.constructed = 0;
        this.started = 0;
        this.stopped = 0;
      },
    },
    extractorState: {
      constructed: 0,
      refreshCalls: 0,
      reset() {
        this.constructed = 0;
        this.refreshCalls = 0;
      },
    },
  };
});

vi.mock("@storybook/preview-api", () => ({
  addons: { getChannel: () => channel },
}));

vi.mock("@real-a11y-dev/core", () => {
  class DomObserver {
    constructor(
      _root: Element,
      _cb: (change?: unknown) => void,
      _debounce: number,
    ) {
      observerState.constructed += 1;
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
      return {
        nodes: new Map([
          [
            "root",
            {
              id: "root",
              a11y: {
                role: "generic",
                name: "",
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
    // module has panelWantsTree === false until REQUEST_TREE arrives again.
    channel.emit(EVENTS.REQUEST_TREE);
    expect(observerState.started).toBe(1);

    // Simulate iframe teardown without manager STOP_TREE (module state lost).
    // Closest in-module stand-in: STOP then a bare storyRendered (idle),
    // followed by the manager's storyRendered → REQUEST_TREE.
    channel.emit(EVENTS.STOP_TREE);
    observerState.reset();
    extractorState.reset();

    channel.emit("storyRendered");
    expect(observerState.constructed).toBe(0);

    channel.emit(EVENTS.REQUEST_TREE);
    expect(observerState.started).toBe(1);
    expect(extractorState.constructed).toBe(1);
  });
});
