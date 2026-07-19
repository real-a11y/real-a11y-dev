import { describe, it, expect, vi, beforeAll } from "vitest";

// In-memory stand-in for the Storybook preview channel so we can drive the
// preview-side event handlers registered at import time. Created via
// vi.hoisted so it exists before the (hoisted) vi.mock factory references it.
const { channel } = vi.hoisted(() => {
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
  };
});

vi.mock("@storybook/preview-api", () => ({
  addons: { getChannel: () => channel },
}));

let EVENTS: typeof import("./constants.js").EVENTS;

beforeAll(async () => {
  // Dynamic import so the bootstrap (which calls getChannel()) runs after the
  // mocked channel is in place and registers its handlers against it.
  await import("./preview.js");
  ({ EVENTS } = await import("./constants.js"));
});

describe("preview channel bootstrap", () => {
  it("does not throw when SET_MODE arrives before a story has rendered", () => {
    // start() (and thus the live extractor) only runs on storyRendered. A mode
    // switch before that must be a safe no-op, not a null dereference.
    expect(() => channel.emit(EVENTS.SET_MODE, "dom")).not.toThrow();
    expect(() => channel.emit(EVENTS.REQUEST_TREE)).not.toThrow();
  });
});
