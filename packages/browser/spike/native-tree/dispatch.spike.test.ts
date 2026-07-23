/**
 * SPIKE 3 — CDP action dispatch (click / type) for native-tree nodes.
 *
 *   pnpm --filter @real-a11y-dev/browser run test:spike
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cdpClick, cdpType, findAx, openAxSession } from "./dispatch.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(join(here, "fixture.html"), "utf8");

describe("native-tree CDP dispatch spike", () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.setContent(fixtureHtml, { waitUntil: "load" });
  }, 60_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  it("clicks an author-DOM button resolved from AX backendDOMNodeId", async () => {
    const { client, nodes } = await openAxSession(page);
    try {
      const save = findAx(nodes, "button", "Save");
      expect(save).toBeTruthy();
      expect(save!.backendDOMNodeId).toEqual(expect.any(Number));

      const before = await page.locator("#clicks").textContent();
      const result = await cdpClick(client, save!);
      expect(result).toMatchObject({ success: true, path: "runtime-call" });

      const after = await page.locator("#clicks").textContent();
      expect(Number(after)).toBe(Number(before) + 1);
    } finally {
      await client.detach().catch(() => {});
    }
  });

  it("types into an author-DOM email field via Runtime.callFunctionOn", async () => {
    const { client, nodes } = await openAxSession(page);
    try {
      const email = findAx(nodes, "textbox", "Email");
      expect(email).toBeTruthy();

      const result = await cdpType(client, email!, "native@example.com");
      expect(result).toMatchObject({ success: true, path: "runtime-call" });

      await expect(page.locator("#email").inputValue()).resolves.toBe(
        "native@example.com",
      );
    } finally {
      await client.detach().catch(() => {});
    }
  });

  it("UA-shadow media control (button play): resolve may succeed but is not author-DOM", async () => {
    const { client, nodes } = await openAxSession(page);
    try {
      const play = findAx(nodes, "button", "play");
      expect(play).toBeTruthy();
      expect(play!.backendDOMNodeId).toEqual(expect.any(Number));

      // Probe: can we resolve + inspect the element?
      await client.send("DOM.enable");
      await client.send("DOM.getDocument", { depth: 0 });
      let resolvedTag: string | null = null;
      let resolveFailed = false;
      try {
        const resolved = (await client.send("DOM.resolveNode", {
          backendNodeId: play!.backendDOMNodeId!,
        })) as { object?: { objectId?: string } };
        const objectId = resolved.object?.objectId;
        if (!objectId) {
          resolveFailed = true;
        } else {
          const evaled = (await client.send("Runtime.callFunctionOn", {
            objectId,
            functionDeclaration: `function () {
              return {
                tagName: this.tagName || null,
                isConnected: !!this.isConnected,
                rootNode: this.getRootNode ? this.getRootNode().nodeName || this.getRootNode().constructor?.name : null,
                inShadow: !!(this.getRootNode && this.getRootNode() !== document),
              };
            }`,
            returnByValue: true,
          })) as {
            result?: {
              value?: {
                tagName: string | null;
                inShadow: boolean;
                rootNode: string | null;
              };
            };
          };
          resolvedTag = evaled.result?.value?.tagName ?? null;

          console.log(
            "play control resolve:",
            JSON.stringify(evaled.result?.value),
          );
        }
      } catch (err) {
        resolveFailed = true;

        console.log(
          "play control resolve threw:",
          err instanceof Error ? err.message : err,
        );
      }

      const click = await cdpClick(client, play!);

      console.log("play control click:", JSON.stringify(click), {
        resolvedTag,
        resolveFailed,
      });

      // Document outcome — either unresolved, or click "succeeds" on a UA
      // control without being a useful author-DOM ActionBackend target.
      expect(play!.backendDOMNodeId).toEqual(expect.any(Number));
      // Soft assertion: we always learn *something* actionable for the RFC.
      expect(
        resolveFailed || click.success || click.path === "unresolved",
      ).toBe(true);
    } finally {
      await client.detach().catch(() => {});
    }
  });

  it("prints spike-3 summary", async () => {
    console.log(
      [
        "",
        "===== SPIKE 3: CDP dispatch =====",
        "author-DOM button click: Runtime.callFunctionOn → element.click() ✓",
        "author-DOM textbox type: prototype value setter + input/change ✓",
        "UA-shadow play: see console lines above for resolve/click outcome",
        "Implication: Phase 2 ActionBackend is feasible for author-DOM nodes;",
        "  media UA controls may resolve but are not the product's primary",
        "  interaction surface — read fidelity remains the forcing function.",
      ].join("\n"),
    );
    expect(true).toBe(true);
  });
});
