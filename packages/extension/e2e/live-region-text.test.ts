/**
 * The content script's own text reads, in a real browser: the live-announcement
 * log and the inline input panel's starting text for a rich-text editor.
 *
 * Both used to be raw `textContent`, which reads a `<textarea>`'s markup text —
 * its DEFAULT value, and for a sensitive field (ADR-0001) the secret itself —
 * and put it on the extension's message channel. The jsdom suites pin the
 * walk; this pins it against Chromium's own parser and CSS, where a stylesheet
 * rule, not an inline style, is what usually hides an element.
 *
 * Like `pick-mode-dom.test.ts`, this drives the DOM path the store build
 * ships. Run it with `pnpm test:e2e`, which rebuilds the bundle first.
 */

import { expect, test } from "./harness";

const SECRETS = ["OTP-SENTINEL", "CARD-SENTINEL", "HIDDEN-SENTINEL"];

test("the live-announcement log reads no textarea's markup text, and nothing hidden", async ({
  nav,
}) => {
  const tab = await nav.open("live-region-text.html");
  // Arms the frame's observers, as the panel opening does.
  await nav.domTree(tab.tabId);
  const mark = await nav.panelMessageCount();

  await tab.page.evaluate(() => {
    document.getElementById("status")!.innerHTML =
      `Code sent <textarea autocomplete="one-time-code">OTP-SENTINEL</textarea>` +
      `<span class="is-hidden">HIDDEN-SENTINEL</span>` +
      `<span aria-hidden="true">HIDDEN-SENTINEL</span>`;
  });

  await expect
    .poll(async () => (await nav.panelMessages("LIVE_REGION", mark)).length)
    .toBeGreaterThan(0);
  const sent = await nav.panelMessages("LIVE_REGION", mark);
  expect(sent.map((m) => m.payload)).toEqual([
    { text: "Code sent", level: "polite", role: "status" },
  ]);
  for (const secret of SECRETS) {
    expect(JSON.stringify(sent)).not.toContain(secret);
  }
});

test("an editor's inline input panel opens without a nested textarea's markup text", async ({
  nav,
}) => {
  const tab = await nav.open("live-region-text.html");
  const tree = await nav.domTree(tab.tabId);
  const editor = tree.nodes.find(
    ([, n]) => n.dom?.attributes?.["id"] === "editor",
  );
  if (!editor) throw new Error("no node for #editor in the merged tree");

  const state = await nav.domFieldState(tab.tabId, editor[0]);

  expect(state.success).toBe(true);
  expect(state.value).toBe("Pay now");
});
