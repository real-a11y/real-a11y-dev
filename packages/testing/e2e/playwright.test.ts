import { test, expect } from "@playwright/test";
import { attach } from "../src/playwright.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

  test("auditSnapshot in dom mode uses role names for semantic elements", async ({ page }) => {
    const sn = await attach(page);
    const snapshot = await sn.auditSnapshot({ mode: "dom" });
    // DOM mode still serializes using ARIA role names (banner, main, contentinfo)
    // derived from the element's implicit role — not raw tag names.
    expect(snapshot).toContain("banner");       // <header>
    expect(snapshot).toContain("main");          // <main>
    expect(snapshot).toContain("contentinfo");   // <footer>
  });

  test("outlineSnapshot captures heading structure", async ({ page }) => {
    const sn = await attach(page);
    const outline = await sn.outlineSnapshot();
    expect(outline).toContain("Test fixture");     // h1
    expect(outline).toContain("Contact form");      // h2
    expect(outline).toContain("Navigation links");  // h2
  });

  test("tabSequenceSnapshot lists focusable elements in order", async ({ page }) => {
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

  test("assertNoUnlabeledInteractive passes for fully labeled form", async ({ page }) => {
    const sn = await attach(page);
    await expect(sn.assertNoUnlabeledInteractive()).resolves.toBeUndefined();
  });

  test("assertLandmarkStructure passes", async ({ page }) => {
    const sn = await attach(page);
    await expect(sn.assertLandmarkStructure()).resolves.toBeUndefined();
  });

  test("assertDialogsLabeled passes when dialog is hidden", async ({ page }) => {
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

  test("assertNoUnlabeledInteractive throws on unlabeled button", async ({ page }) => {
    const sn = await attach(page);
    await expect(sn.assertNoUnlabeledInteractive()).rejects.toThrow();
  });

  test("assertLandmarkStructure throws on missing main", async ({ page }) => {
    const sn = await attach(page);
    await expect(sn.assertLandmarkStructure()).rejects.toThrow();
  });

  test("assertDialogsLabeled throws on unlabeled open dialog", async ({ page }) => {
    const sn = await attach(page);
    await expect(sn.assertDialogsLabeled()).rejects.toThrow();
  });
});
