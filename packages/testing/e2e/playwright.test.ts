import path from "node:path";

import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { attach } from "../src/playwright.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fixtureUrl(name: string) {
  return `file://${path.join(__dirname, name).replace(/\\/g, "/")}`;
}

// ─── Good fixture ────────────────────────────────────────────────────────────

test.describe("good fixture", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(fixtureUrl("fixture.html"));
  });

  test("attach() injects the bundle and returns a handle", async ({ page }) => {
    const sn = await attach(page);
    expect(sn).toBeDefined();
    expect(typeof sn.auditSnapshot).toBe("function");
    expect(typeof sn.assertHeadingOrder).toBe("function");
  });

  test("auditSnapshot returns a non-empty string", async ({ page }) => {
    const sn = await attach(page);
    const snapshot = await sn.auditSnapshot();
    expect(typeof snapshot).toBe("string");
    expect(snapshot.length).toBeGreaterThan(0);
    expect(snapshot).toContain("Test fixture");
    expect(snapshot).toContain("Contact form");
  });

  test("auditSnapshot in dom mode uses role names for semantic elements", async ({
    page,
  }) => {
    const sn = await attach(page);
    const snapshot = await sn.auditSnapshot({ mode: "dom" });
    // DOM mode still serializes using ARIA role names (banner, main, contentinfo)
    // derived from the element's implicit role — not raw tag names.
    expect(snapshot).toContain("banner"); // <header>
    expect(snapshot).toContain("main"); // <main>
    expect(snapshot).toContain("contentinfo"); // <footer>
  });

  test("outlineSnapshot captures heading structure", async ({ page }) => {
    const sn = await attach(page);
    const outline = await sn.outlineSnapshot();
    expect(outline).toContain("Test fixture"); // h1
    expect(outline).toContain("Contact form"); // h2
    expect(outline).toContain("Navigation links"); // h2
  });

  test("tabSequenceSnapshot lists focusable elements in order", async ({
    page,
  }) => {
    const sn = await attach(page);
    const seq = await sn.tabSequenceSnapshot();
    expect(seq).toContain("Home");
    expect(seq).toContain("About");
    expect(seq).toContain("Send message");
    expect(seq).toContain("Documentation");
  });

  test("assertHeadingOrder passes for correct structure", async ({ page }) => {
    const sn = await attach(page);
    await expect(sn.assertHeadingOrder()).resolves.toBeUndefined();
  });

  test("assertNoUnlabeledInteractive passes for fully labeled form", async ({
    page,
  }) => {
    const sn = await attach(page);
    await expect(sn.assertNoUnlabeledInteractive()).resolves.toBeUndefined();
  });

  test("assertLandmarkStructure passes", async ({ page }) => {
    const sn = await attach(page);
    await expect(sn.assertLandmarkStructure()).resolves.toBeUndefined();
  });

  test("assertDialogsLabeled passes when dialog is hidden", async ({
    page,
  }) => {
    // The dialog is not open by default — assertDialogsLabeled should still
    // inspect it (dialog elements are in the DOM even when closed)
    const sn = await attach(page);
    await expect(sn.assertDialogsLabeled()).resolves.toBeUndefined();
  });

  test("rootSelector narrows the audit to a subtree", async ({ page }) => {
    const sn = await attach(page, { rootSelector: "form" });
    const snapshot = await sn.auditSnapshot();
    // Form contents visible
    expect(snapshot).toContain("Send message");
    // Page-level heading not in form subtree
    expect(snapshot).not.toContain("Test fixture");
  });

  test("auditSnapshot is stable across multiple calls", async ({ page }) => {
    const sn = await attach(page);
    const snap1 = await sn.auditSnapshot();
    const snap2 = await sn.auditSnapshot();
    expect(snap1).toBe(snap2);
  });

  test("auditSnapshot redacts matching accessible names", async ({ page }) => {
    // Proves a RegExp survives the marshalling across the page.evaluate()
    // boundary and redaction runs inside the page.
    const sn = await attach(page);
    const snapshot = await sn.auditSnapshot({ redact: [/Test fixture/g] });
    expect(snapshot).not.toContain("Test fixture");
    expect(snapshot).toContain("[REDACTED]");
  });
});

// ─── Native producer (attach with { tree: "native" }) ───────────────────────
// `attach(page, { tree: "native" })` skips page-bundle injection and reads
// Chromium's own accessibility tree over CDP, then runs the same serialize/
// audit helpers in Node. Same handle shape, one telling difference: the native
// tree reaches a <video controls>'s play/scrubber/mute controls, which live in
// a CLOSED user-agent shadow root the DOM producer's in-page walk can't see.

test.describe("native tree", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(fixtureUrl("fixture-native.html"));
  });

  test("auditSnapshot returns the document tree with landmarks and headings", async ({
    page,
  }) => {
    const sn = await attach(page, { tree: "native" });
    const snapshot = await sn.auditSnapshot();
    expect(snapshot.length).toBeGreaterThan(0);
    // Whole-document native trees synthesize a `document` root.
    expect(snapshot).toContain("document");
    expect(snapshot).toContain('heading "Native tree fixture" (level 1)');
    expect(snapshot).toContain('button "Send message"');
    expect(snapshot).toContain('navigation "Main navigation"');
  });

  test("native tree reaches UA-shadow media controls the DOM producer can't", async ({
    page,
  }) => {
    const nativeSnap = await (
      await attach(page, { tree: "native" })
    ).auditSnapshot();
    const domSnap = await (await attach(page)).auditSnapshot();

    // The <video controls>' scrubber lives in a closed UA shadow root. Native
    // sees it; the DOM walk stops at the <video> element.
    expect(nativeSnap).toContain("slider");
    expect(nativeSnap).toContain("video time scrubber");
    expect(domSnap).not.toContain("slider");
  });

  test("outlineSnapshot captures heading structure", async ({ page }) => {
    const sn = await attach(page, { tree: "native" });
    const outline = await sn.outlineSnapshot();
    expect(outline).toContain("Native tree fixture"); // h1
    expect(outline).toContain("Contact form"); // h2
  });

  test("assertHeadingOrder passes for correct structure", async ({ page }) => {
    const sn = await attach(page, { tree: "native" });
    await expect(sn.assertHeadingOrder()).resolves.toBeUndefined();
  });

  test("assertLandmarkStructure passes", async ({ page }) => {
    const sn = await attach(page, { tree: "native" });
    await expect(sn.assertLandmarkStructure()).resolves.toBeUndefined();
  });

  test("assertNoUnlabeledInteractive passes over the UA-shadow media controls", async ({
    page,
  }) => {
    // The native tree surfaces the <video controls> UA-shadow controls (play,
    // scrubber, "show more"), which the DOM producer never sees — so this
    // assertion runs over interactive nodes DOM-mode audits can't reach. Chromium
    // names its media controls (a UA accessibility guarantee), so a fully labeled
    // page still passes in native mode. This locks that in: a future Chromium that
    // shipped an unnamed control would trip here rather than silently in a
    // consumer's suite.
    const sn = await attach(page, { tree: "native" });
    await expect(sn.assertNoUnlabeledInteractive()).resolves.toBeUndefined();
  });

  test("tabSequenceSnapshot throws — a native tree carries no interaction data", async ({
    page,
  }) => {
    const sn = await attach(page, { tree: "native" });
    await expect(sn.tabSequenceSnapshot()).rejects.toThrow(/read-only/);
  });

  test("rootSelector scoping is rejected up front", async ({ page }) => {
    await expect(
      attach(page, { tree: "native", rootSelector: "main" }),
    ).rejects.toThrow(/rootSelector/);
  });
});

// ─── Bad fixture (assertions must fail) ──────────────────────────────────────

test.describe("bad fixture — assertions should throw", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(fixtureUrl("fixture-bad.html"));
  });

  test("assertHeadingOrder throws on missing h1", async ({ page }) => {
    const sn = await attach(page);
    await expect(sn.assertHeadingOrder()).rejects.toThrow();
  });

  test("assertNoUnlabeledInteractive throws on unlabeled button", async ({
    page,
  }) => {
    const sn = await attach(page);
    await expect(sn.assertNoUnlabeledInteractive()).rejects.toThrow();
  });

  test("assertLandmarkStructure throws on missing main", async ({ page }) => {
    const sn = await attach(page);
    await expect(sn.assertLandmarkStructure()).rejects.toThrow();
  });

  test("assertDialogsLabeled throws on unlabeled open dialog", async ({
    page,
  }) => {
    const sn = await attach(page);
    await expect(sn.assertDialogsLabeled()).rejects.toThrow();
  });
});

// ─── Contenteditable rich-text widgets (Slack-shaped) ────────────────────────
// Real rich editors (Slack, Notion, Google Docs, Quill/ProseMirror/Lexical)
// build their textbox/combobox on a contenteditable <div>, not a native
// <input>. These assert the extractor sees them as the right ARIA widgets.

test.describe("contenteditable rich-text widgets", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(fixtureUrl("fixture-contenteditable.html"));
  });

  test("a contenteditable role=textbox serializes as a textbox (Slack message box)", async ({
    page,
  }) => {
    const sn = await attach(page);
    const snapshot = await sn.auditSnapshot();
    expect(snapshot).toContain('textbox "Message to general"');
  });

  test("an editable (contenteditable) combobox serializes as a combobox (Slack search)", async ({
    page,
  }) => {
    const sn = await attach(page);
    const snapshot = await sn.auditSnapshot();
    expect(snapshot).toContain('combobox "Search"');
  });

  test("a native <input role=combobox> serializes as a combobox (W3C APG example shape)", async ({
    page,
  }) => {
    const sn = await attach(page);
    const snapshot = await sn.auditSnapshot();
    expect(snapshot).toContain('combobox "State"');
  });
});

// ─── Injection + root resolution hardening ───────────────────────────────────

test.describe("strict CSP page", () => {
  test("attach() injects the bundle despite a strict Content-Security-Policy", async ({
    page,
  }) => {
    // This fixture sends `script-src 'self'` (no 'unsafe-inline'), so appending
    // an inline <script> — what `addScriptTag({ content })` does — is blocked.
    // Evaluating the bundle source instead is not subject to page CSP, which is
    // what makes auditing a production-like deployment possible at all.
    await page.goto(fixtureUrl("fixture-csp.html"));
    const sn = await attach(page);
    const snapshot = await sn.auditSnapshot();
    expect(snapshot).toContain("CSP page");
  });
});

test.describe("rootSelector that matches nothing", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(fixtureUrl("fixture.html"));
  });

  test("auditSnapshot rejects instead of silently auditing the whole body", async ({
    page,
  }) => {
    const sn = await attach(page, { rootSelector: "#does-not-exist" });
    await expect(sn.auditSnapshot()).rejects.toThrow(/#does-not-exist/);
  });

  test("assertions reject instead of running against the whole body", async ({
    page,
  }) => {
    // Same contract on the evalFn path that every assertion helper routes
    // through — a typo'd selector must not quietly pass by auditing everything.
    const sn = await attach(page, { rootSelector: "#does-not-exist" });
    await expect(sn.assertHeadingOrder()).rejects.toThrow(/matched no element/);
  });
});
