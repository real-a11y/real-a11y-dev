/**
 * SPIKE — desktop Semantic Navigator idea validation.
 *
 *   pnpm --filter @real-a11y-dev/browser run test:spike:desktop
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DesktopNavigatorSession, startPanelServer } from "./session.js";

describe("desktop navigator spike", () => {
  let session: DesktopNavigatorSession;
  let server: { port: number; close: () => Promise<void> };
  let base: string;

  beforeAll(async () => {
    session = new DesktopNavigatorSession();
    await session.start();
    server = await startPanelServer(session);
    base = `http://127.0.0.1:${server.port}`;
  }, 60_000);

  afterAll(async () => {
    await server?.close().catch(() => {});
    await session?.close().catch(() => {});
  });

  it("exposes a tree-only panel (no page preview) over HTTP", async () => {
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toMatch(/Semantic Navigator/);
    expect(html).toMatch(/Curtain ON/);
    expect(html).not.toMatch(/iframe|webview|page preview/i);
  });

  it("native CDP tree includes checkout controls", async () => {
    const { nodes } = (await (await fetch(`${base}/api/tree`)).json()) as {
      nodes: Array<{ role: string; name: string }>;
    };
    const label = (n: { role: string; name: string }) =>
      n.name ? `${n.role} "${n.name}"` : n.role;
    const labels = nodes.map(label);
    expect(labels.some((l) => /heading "Checkout"/i.test(l))).toBe(true);
    expect(labels.some((l) => /button "Pay now"/i.test(l))).toBe(true);
    expect(labels.some((l) => /checkbox "This is a gift"/i.test(l))).toBe(true);
  });

  it("auditor completes checkout through the tree without seeing the page", async () => {
    const { nodes } = (await (await fetch(`${base}/api/tree`)).json()) as {
      nodes: Array<{
        role: string;
        name: string;
        backendDOMNodeId: number | null;
      }>;
    };

    const gift = nodes.find(
      (n) => n.role === "checkbox" && /gift/i.test(n.name),
    );
    const pay = nodes.find(
      (n) => n.role === "button" && /pay now/i.test(n.name),
    );
    expect(gift?.backendDOMNodeId).toEqual(expect.any(Number));
    expect(pay?.backendDOMNodeId).toEqual(expect.any(Number));

    expect(await session.giftChecked()).toBe(false);

    const afterGift = await (
      await fetch(`${base}/api/click`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ backendDOMNodeId: gift!.backendDOMNodeId }),
      })
    ).json();
    expect(afterGift.ok).toBe(true);
    expect(await session.giftChecked()).toBe(true);

    const afterPay = await (
      await fetch(`${base}/api/click`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ backendDOMNodeId: pay!.backendDOMNodeId }),
      })
    ).json();
    expect(afterPay.ok).toBe(true);
    expect(afterPay.status).toMatch(/Gift order placed for buyer@example.com/);

    console.log(
      [
        "",
        "===== DESKTOP NAVIGATOR SPIKE =====",
        "Auditor UI: tree-only panel (no visual page).",
        "Browser: headless Chromium + curtain overlay.",
        "Actions: CDP resolve → click checkbox → click Pay now.",
        `Result status: ${afterPay.status}`,
        "Thesis validated: task completable via a11y tree alone.",
      ].join("\n"),
    );
  });
});
