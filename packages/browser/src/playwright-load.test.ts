import { describe, expect, it } from "vitest";

import { loadPlaywright, resolvePlaywrightEntry } from "./playwright-load.js";

describe("loadPlaywright", () => {
  it("resolves the workspace playwright and loads chromium from that entry", async () => {
    const entry = resolvePlaywrightEntry();
    expect(entry).toEqual(expect.stringMatching(/playwright/));
    const playwright = await loadPlaywright();
    expect(playwright.chromium).toBeDefined();
    expect(playwright.devices["iPhone 13"]).toBeDefined();
  });

  it("throws ERR_MODULE_NOT_FOUND from a URL that cannot see playwright", async () => {
    // A data: URL has no filesystem walk and no NODE_PATH parent, so
    // createRequire cannot reach this workspace's playwright.
    await expect(loadPlaywright("data:text/javascript,")).rejects.toMatchObject(
      {
        code: "ERR_MODULE_NOT_FOUND",
        message: expect.stringMatching(/playwright/),
      },
    );
    expect(resolvePlaywrightEntry("data:text/javascript,")).toBeUndefined();
  });
});
