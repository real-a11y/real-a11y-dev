import { describe, expect, it } from "vitest";

import {
  isPlaywrightMissing,
  loadPlaywright,
  resolvePlaywrightEntry,
} from "./playwright-load.js";

describe("loadPlaywright", () => {
  it("resolves the workspace playwright and loads chromium from that entry", async () => {
    const entry = resolvePlaywrightEntry();
    expect(entry).toEqual(expect.stringMatching(/playwright/));
    const playwright = await loadPlaywright();
    expect(typeof playwright.chromium.launch).toBe("function");
    expect(playwright.devices["iPhone 13"]).toBeDefined();
    expect(entry).toMatch(/index\.mjs$/);
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

describe("isPlaywrightMissing", () => {
  const moduleError = (message: string, code: string) =>
    Object.assign(new Error(message), { code });

  it("recognizes the error loadPlaywright throws", async () => {
    // The MCP server's install hint keys on this. Reword the loader's error
    // and this fails, rather than the hint going quiet.
    const err: unknown = await loadPlaywright("data:text/javascript,").catch(
      (e: unknown) => e,
    );
    expect(isPlaywrightMissing(err)).toBe(true);
  });

  it("recognizes Node's own errors for a bare import or require", () => {
    expect(
      isPlaywrightMissing(
        moduleError(
          "Cannot find package 'playwright' imported from /app/server.js",
          "ERR_MODULE_NOT_FOUND",
        ),
      ),
    ).toBe(true);
    expect(
      isPlaywrightMissing(
        moduleError(
          "Cannot find module 'playwright'\nRequire stack:\n- /app/server.cjs",
          "MODULE_NOT_FOUND",
        ),
      ),
    ).toBe(true);
  });

  it("leaves other missing modules alone", () => {
    // A missing dependency of an installed Playwright, and a module imported
    // FROM a playwright-load chunk, both mention playwright without being it.
    expect(
      isPlaywrightMissing(
        moduleError(
          "Cannot find package 'playwright-core' imported from /app/node_modules/playwright/index.mjs",
          "ERR_MODULE_NOT_FOUND",
        ),
      ),
    ).toBe(false);
    expect(
      isPlaywrightMissing(
        moduleError(
          "Cannot find package 'zod' imported from /app/dist/playwright-load-ABC123.js",
          "ERR_MODULE_NOT_FOUND",
        ),
      ),
    ).toBe(false);
    expect(
      isPlaywrightMissing(new Error("Cannot find package 'playwright'")),
    ).toBe(false);
    expect(isPlaywrightMissing("Cannot find package 'playwright'")).toBe(false);
  });
});
