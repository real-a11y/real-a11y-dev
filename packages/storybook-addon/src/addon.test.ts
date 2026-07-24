import { describe, it, expect } from "vitest";

import { ADDON_ID, EVENTS, PANEL_ID } from "./index.js";

describe("addon constants", () => {
  it("exposes a unique addon id and panel id", () => {
    expect(ADDON_ID).toMatch(/^real-a11y\//);
    expect(PANEL_ID).toBe(`${ADDON_ID}/panel`);
  });

  it("defines distinct channel events", () => {
    expect(EVENTS.TREE_UPDATED).not.toBe(EVENTS.SET_MODE);
    expect(EVENTS.TREE_UPDATED).toMatch(/tree-updated$/);
    expect(EVENTS.PREVIEW_READY).toMatch(/preview-ready$/);
    expect(EVENTS.REQUEST_TREE).toMatch(/request-tree$/);
    expect(EVENTS.STOP_TREE).toMatch(/stop-tree$/);
    expect(EVENTS.SET_MODE).toMatch(/set-mode$/);
  });
});
