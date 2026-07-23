/**
 * SPIKE — native a11y tree in the extension via chrome.debugger.
 *
 * What this proves (or kills), per RFC v3's open ordering question:
 *  1. An MV3 service worker can attach chrome.debugger to a tab and read
 *     `Accessibility.getFullAXTree` — including UA-shadow media controls the
 *     content script (DOM producer) can never see.
 *  2. Action dispatch through the tree works over chrome.debugger too
 *     (backendDOMNodeId → DOM.resolveNode → Runtime.callFunctionOn).
 *  3. The "third CDP transport" tax is avoidable by construction: the SAME
 *     native-core module runs here over Playwright's CDPSession and inside
 *     the worker over chrome.debugger.sendCommand, and the outputs match.
 *  4. Debugger exclusivity (the DevTools-conflict class of problem) is
 *     probed mechanically via a second attach.
 *
 *   pnpm --filter @real-a11y-dev/semantic-navigator-extension run test:spike
 *
 * Requires full Chromium (extensions don't load in the headless shell) —
 * launched via Playwright's "chromium" channel in new-headless mode.
 */

import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type BrowserContext, type Worker } from "playwright";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readNativeTree, type CdpTransport } from "./native-core.js";

const here = dirname(fileURLToPath(import.meta.url));
const extDir = join(here, "dist");
const fixtureHtml = readFileSync(join(here, "fixture.html"), "utf8");

async function bundleExtension(): Promise<void> {
  await mkdir(extDir, { recursive: true });
  await build({
    configFile: false,
    logLevel: "silent",
    build: {
      lib: {
        entry: join(here, "sw.ts"),
        formats: ["es"],
        fileName: () => "sw.js",
      },
      outDir: extDir,
      emptyOutDir: true,
      target: "chrome120",
      minify: false,
    },
  });
  await copyFile(join(here, "manifest.json"), join(extDir, "manifest.json"));
}

function serveFixture(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(fixtureHtml);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("failed to bind fixture server");
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}/` });
    });
  });
}

describe("extension chrome.debugger native-tree spike", () => {
  let context: BrowserContext;
  let sw: Worker;
  let server: Server;
  let fixtureUrl: string;
  let tabId: number;

  beforeAll(async () => {
    await bundleExtension();
    ({ server, url: fixtureUrl } = await serveFixture());

    // Extensions need full Chromium; the "chromium" channel selects the real
    // browser in new-headless mode instead of the extension-less headless
    // shell. Sandbox note: CI never runs spikes; locally this needs the
    // chromium build Playwright installed.
    context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extDir}`,
        `--load-extension=${extDir}`,
      ],
    });

    sw =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));

    const page = await context.newPage();
    await page.goto(fixtureUrl, { waitUntil: "load" });

    const found = await sw.evaluate(
      (prefix) => globalThis.__spike.findTab(prefix),
      fixtureUrl,
    );
    if (typeof found !== "number") throw new Error("fixture tab not found");
    tabId = found;
  });

  afterAll(async () => {
    await context?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("service worker reads UA-shadow media controls the content script cannot see", async () => {
    const result = await sw.evaluate(
      (id) => globalThis.__spike.readTree(id),
      tabId,
    );

    // Note: the authored aria-label ("Product tour") is replaced by the
    // load-state name "Unable to play media." when the source can't load —
    // the exact §5.4 name-drift the RFC's normalizer must canonicalize.
    expect(result.serialized).toMatch(/^\s*video "/m);
    // The forcing function, now inside the extension: UA-shadow controls.
    expect(result.serialized).toContain('button "play"');
    expect(result.serialized).toMatch(
      /slider "(video time scrubber|audio time scrubber)"/,
    );
    // Sanity: author DOM is there too.
    expect(result.serialized).toContain('heading "Debugger native spike"');
    expect(result.serialized).toContain('button "Add item"');
  });

  it("completes the counter task through the tree in one attached session", async () => {
    const result = await sw.evaluate(
      (args) => globalThis.__spike.session(args.id, args.role, args.name),
      { id: tabId, role: "button", name: "Add item" },
    );

    expect(result.click).toEqual({ ok: true });
    expect(result.before).toContain('status "Cart status"');
    expect(result.after).toContain('status "Cart status: 1"');
  });

  it("same native-core module over Playwright CDPSession yields the identical tree", async () => {
    const swResult = await sw.evaluate(
      (id) => globalThis.__spike.readTree(id),
      tabId,
    );

    const page = context.pages().find((p) => p.url() === fixtureUrl);
    if (!page) throw new Error("fixture page missing");
    const session = await context.newCDPSession(page);
    try {
      const transport: CdpTransport = {
        send: <T>(method: string, params?: object) =>
          session.send(
            method as Parameters<typeof session.send>[0],
            params,
          ) as Promise<T>,
      };
      const nodeResult = await readNativeTree(transport);

      // The whole point: one module, two transports, one output.
      expect(nodeResult.serialized).toBe(swResult.serialized);
    } finally {
      await session.detach().catch(() => {});
    }
  });

  it("probes debugger exclusivity (the DevTools-conflict failure class)", async () => {
    const result = await sw.evaluate(
      (id) => globalThis.__spike.doubleAttach(id),
      tabId,
    );

    expect(result.secondAttach).not.toBe("unexpectedly-succeeded");
    // Chrome's message for an occupied target — what users would hit with
    // DevTools open. Recorded for the spike report.
    console.log(`second attach → ${result.secondAttach}`);
  });

  it("smoke: extension bundle contains no playwright/node imports", () => {
    const bundled = readFileSync(join(extDir, "sw.js"), "utf8");
    expect(existsSync(join(extDir, "manifest.json"))).toBe(true);
    expect(bundled).not.toMatch(/require\(|from "playwright"|node:/);
  });
});
