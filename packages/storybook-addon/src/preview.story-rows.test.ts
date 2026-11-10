import { getNodeId } from "@real-a11y-dev/core";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { EVENTS, type TreeUpdatePayload } from "./constants.js";

// The preview with the real core: which rows of a read widened past the story
// root it says are the page's (`storyRows`). `preview.test.ts` mocks core.
const channel = vi.hoisted(() => {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    on: (event: string, cb: (...args: unknown[]) => void) =>
      handlers.set(event, [...(handlers.get(event) ?? []), cb]),
    off: (event: string, cb: (...args: unknown[]) => void) =>
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((listener) => listener !== cb),
      ),
    emit: (event: string, ...args: unknown[]) => {
      for (const cb of [...(handlers.get(event) ?? [])]) cb(...args);
    },
  };
});

vi.mock("storybook/preview-api", () => ({
  addons: { getChannel: () => channel },
}));

let cleanup: (() => void) | undefined;

beforeAll(async () => {
  document.body.innerHTML = `
    <nav aria-label="Preview chrome"><a href="/">Home</a></nav>
    <div id="storybook-root"><div id="story"><button>Open</button></div></div>
  `;
  cleanup = (await import("./preview.js")).beforeAll();
});

afterAll(() => {
  channel.emit(EVENTS.STOP_TREE);
  cleanup?.();
  document.body.innerHTML = "";
});

it("says the page around the story is the page's when a toast widens the read", async () => {
  const updates: TreeUpdatePayload[] = [];
  channel.on(EVENTS.TREE_UPDATED, (payload) =>
    updates.push(payload as TreeUpdatePayload),
  );
  channel.emit(EVENTS.REQUEST_TREE, "a11y");
  const storyRootId = getNodeId(document.getElementById("story")!);
  expect(updates[0]!.storyRows).toEqual({ rootId: storyRootId, outside: [] });

  const toast = document.createElement("div");
  toast.setAttribute("role", "status");
  toast.textContent = "Saved";
  document.body.appendChild(toast);
  await vi.waitFor(() => expect(updates).toHaveLength(2), { timeout: 2000 });

  const wide = updates[1]!;
  const named = (name: string) =>
    wide.tree.nodes.find(([, node]) => node.a11y.name === name)![0];
  const outside = wide.storyRows!.outside;
  expect(wide.tree.rootId).not.toBe(storyRootId);
  expect(outside).toEqual(
    expect.arrayContaining([named("Preview chrome"), named("Home")]),
  );
  expect(outside).not.toContain(named("Open"));
  expect(outside).not.toContain(named("Saved"));
  expect(outside).not.toContain(storyRootId);
});
