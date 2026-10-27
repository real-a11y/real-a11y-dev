import { Channel } from "storybook/internal/channels";
import { definePreview } from "storybook/internal/csf";
import { addons, composeConfigs } from "storybook/preview-api";
import { describe, it, expect, vi } from "vitest";

import * as previewEntry from "./preview.js";

import { ADDON_ID, EVENTS, PANEL_ID, realA11y } from "./index.js";

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

// Against Storybook's real composition, not a mock of it: these are the two
// ways a project's annotations get built, and the preview has to come alive
// through each of them exactly once.
describe("preview annotations", () => {
  /** Composes `annotations`' `beforeAll` and runs it the way the preview does. */
  async function bootstrap(beforeAll: (() => unknown) | undefined) {
    const channel = new Channel({});
    addons.setChannel(channel);
    const ready = vi.fn();
    channel.on(EVENTS.PREVIEW_READY, ready);
    const cleanup = (await beforeAll?.()) as (() => unknown) | undefined;
    await cleanup?.();
    return ready;
  }

  it("hands a CSF Next preview the preview entry's own beforeAll", async () => {
    addons.setChannel(new Channel({}));
    const cleanup = await realA11y().beforeAll();
    try {
      // Already wired, by the same module instance the entry exports.
      expect(previewEntry.beforeAll()).toBeUndefined();
    } finally {
      cleanup?.();
    }
  });

  it("comes alive once in a definePreview that names it", async () => {
    const preview = definePreview({ addons: [realA11y()] });
    expect(await bootstrap(preview.composed.beforeAll)).toHaveBeenCalledTimes(
      1,
    );
  });

  it("comes alive once in a definePreview that names the preview entry", async () => {
    // What `storybook add` and the CSF Next automigration write for an addon
    // outside the `@storybook/` scope: `import * as x from "<addon>/preview"`.
    const preview = definePreview({ addons: [previewEntry] });
    expect(await bootstrap(preview.composed.beforeAll)).toHaveBeenCalledTimes(
      1,
    );
  });

  it("comes alive once in a definePreview that names it both ways", async () => {
    const preview = definePreview({ addons: [realA11y(), previewEntry] });
    expect(await bootstrap(preview.composed.beforeAll)).toHaveBeenCalledTimes(
      1,
    );
  });

  it("comes alive once in a classic preview, which composes the entry from main.ts", async () => {
    const composed = composeConfigs([previewEntry]);
    expect(await bootstrap(composed.beforeAll)).toHaveBeenCalledTimes(1);
  });
});
