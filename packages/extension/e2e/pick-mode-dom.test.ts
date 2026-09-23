/**
 * The element picker vs. a panel-driven action, in a real browser.
 *
 * This is the only file here that drives the DOM producer — the path the
 * SHIPPED store build uses. Every other suite drives the dev-only native path
 * over `chrome.debugger`, so none of them would notice a regression in the
 * in-page content script at all.
 *
 * It is here because the bug it guards is made of exactly the things a jsdom
 * unit test has to fake:
 *
 *  - **Real capture-phase interception.** The picker installs document-level
 *    capture listeners and `preventDefault`s the dispatcher's whole synthetic
 *    pointer sequence. Whether a click "landed" is therefore a property of
 *    Chromium's own event dispatch, not of a DOM shim — so the fixture counts
 *    clicks the page itself received, and the assertion reads that counter.
 *  - **Real frames.** Pick mode is armed per frame while the panel's toggle is
 *    per tab. A panel-level test can only assert that the disarm broadcast was
 *    SENT; only a second document shows whether it arrived and disarmed
 *    anything.
 *
 * Run these with `pnpm test:e2e`, not `playwright test` directly. The suite
 * loads a BUILD (`dist-dogfood/`), and only the `pretest:e2e` hook rebuilds
 * it — so running Playwright on its own after editing `src/` silently tests
 * the previous bundle. That is not hypothetical: it is why these three first
 * appeared to pass against unfixed source.
 */

import { expect, test } from "./harness";

/** Clicks the fixture's own listener has seen, in the named frame. */
async function clicksIn(
  tab: { page: import("@playwright/test").Page },
  frame: "top" | "child",
): Promise<number> {
  if (frame === "top") {
    return await tab.page.evaluate(
      () => (window as unknown as { clicks: number }).clicks,
    );
  }
  const child = tab.page
    .frames()
    .find((f) => f.url().includes("pick-mode-frame"));
  if (!child) throw new Error("subframe not attached");
  return await child.evaluate(
    () => (window as unknown as { clicks: number }).clicks,
  );
}

/** The node id of the fixture's `<button>` in the given frame's tree. */
function buttonId(
  nodes: [string, { dom?: { attributes?: Record<string, string> } }][],
  domId: string,
): string {
  const hit = nodes.find(([, n]) => n.dom?.attributes?.["id"] === domId);
  if (!hit) throw new Error(`no node for #${domId} in the merged tree`);
  return hit[0];
}

test("a tree action while pick mode is armed never reaches the page", async ({
  nav,
}) => {
  const tab = await nav.open("pick-mode.html");
  const tree = await nav.domTree(tab.tabId);
  const target = buttonId(tree.nodes, "target");

  await nav.setPickMode(tab.tabId, true);
  const mark = await nav.panelMessageCount();

  const result = await nav.domAct(tab.tabId, target, "click");

  // The headline defect first, so a regression names itself: the synthetic
  // click used to reach the picker's own handler, which resolved the actioned
  // element and reported it as a pick the user never made — then closed the
  // mode on its way out.
  expect(await nav.panelMessages("NODE_PICKED", mark)).toEqual([]);
  // Only the transitions to OFF: each frame acknowledges being ARMED with a
  // `PICK_MODE_CHANGED {enabled:true}`, and those land asynchronously, so
  // some arrive after the mark. The claim here is that nothing turned the
  // mode off — which is what the picker's auto-exit after a pick did.
  const closed = (await nav.panelMessages("PICK_MODE_CHANGED", mark)).filter(
    (m) => (m.payload as { enabled?: boolean } | undefined)?.enabled === false,
  );
  expect(closed).toEqual([]);

  // Refused, rather than swallowed while reporting success.
  expect(result.success).toBe(false);
  expect(result.error).toContain("pick mode");

  // `clicks` is 0 either way — the picker swallowed the sequence before the
  // fix too. It is asserted to pin that refusing did not start letting the
  // action through, which would be the opposite regression.
  expect(await clicksIn(tab, "top")).toBe(0);
});

test("the same action lands once pick mode is off", async ({ nav }) => {
  const tab = await nav.open("pick-mode.html");
  const tree = await nav.domTree(tab.tabId);
  const target = buttonId(tree.nodes, "target");

  await nav.setPickMode(tab.tabId, true);
  await nav.setPickMode(tab.tabId, false);

  const result = await nav.domAct(tab.tabId, target, "click");

  expect(result.success).toBe(true);
  expect(await clicksIn(tab, "top")).toBe(1);
});

// The one that a panel-level test cannot reach: pick mode is per frame, so
// "turned it off" has to be true of the SUBFRAME too, not just of the frame
// the panel happened to talk to.
test("leaving pick mode disarms the subframe as well as the top frame", async ({
  nav,
}) => {
  const tab = await nav.open("pick-mode.html");
  const tree = await nav.domTree(tab.tabId);
  const inFrame = buttonId(tree.nodes, "frame-target");

  await nav.setPickMode(tab.tabId, true);
  // While armed, the subframe's own picker eats its actions too.
  const refused = await nav.domAct(tab.tabId, inFrame, "click");
  expect(refused.success).toBe(false);
  expect(await clicksIn(tab, "child")).toBe(0);

  await nav.setPickMode(tab.tabId, false);

  const allowed = await nav.domAct(tab.tabId, inFrame, "click");
  expect(allowed.success).toBe(true);
  expect(await clicksIn(tab, "child")).toBe(1);
});
