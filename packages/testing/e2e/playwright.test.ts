import path from "node:path";

import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";
import { pageBundleSource } from "@real-a11y-dev/browser";

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
    expect(typeof sn.treeSnapshot).toBe("function");
    expect(typeof sn.assertHeadingOrder).toBe("function");
  });

  test("treeSnapshot returns a non-empty string", async ({ page }) => {
    const sn = await attach(page);
    const snapshot = await sn.treeSnapshot();
    expect(typeof snapshot).toBe("string");
    expect(snapshot.length).toBeGreaterThan(0);
    expect(snapshot).toContain("Test fixture");
    expect(snapshot).toContain("Contact form");
  });

  test("treeSnapshot in dom mode uses role names for semantic elements", async ({
    page,
  }) => {
    const sn = await attach(page);
    const snapshot = await sn.treeSnapshot({ mode: "dom" });
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
    const snapshot = await sn.treeSnapshot();
    // Form contents visible
    expect(snapshot).toContain("Send message");
    // Page-level heading not in form subtree
    expect(snapshot).not.toContain("Test fixture");
  });

  test("treeSnapshot is stable across multiple calls", async ({ page }) => {
    const sn = await attach(page);
    const snap1 = await sn.treeSnapshot();
    const snap2 = await sn.treeSnapshot();
    expect(snap1).toBe(snap2);
  });

  test("treeSnapshot redacts matching accessible names", async ({ page }) => {
    // Proves a RegExp survives the marshalling across the page.evaluate()
    // boundary and redaction runs inside the page.
    const sn = await attach(page);
    const snapshot = await sn.treeSnapshot({ redact: [/Test fixture/g] });
    expect(snapshot).not.toContain("Test fixture");
    expect(snapshot).toContain("[REDACTED]");
  });

  test("treeSnapshot prints field values only with values: true (ADR-0001)", async ({
    page,
  }) => {
    // Proves `values` survives the page.evaluate() marshalling — the adapter
    // picks option keys one by one, so a key it forgets is silently dropped.
    await page.fill("#name", "Ada Lovelace");
    const sn = await attach(page);
    expect(await sn.treeSnapshot()).not.toContain("Ada Lovelace");
    expect(await sn.treeSnapshot({ values: true })).toContain(
      'textbox "Full name" = "Ada Lovelace"',
    );
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

  test("treeSnapshot returns the document tree with landmarks and headings", async ({
    page,
  }) => {
    const sn = await attach(page, { tree: "native" });
    const snapshot = await sn.treeSnapshot();
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
    ).treeSnapshot();
    const domSnap = await (await attach(page)).treeSnapshot();

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

  test("a field's value is in the tree, printed only when a snapshot asks (ADR-0001)", async ({
    page,
  }) => {
    await page.fill("#name", "Ada Lovelace");
    // A password field, filled — its value must never print, nor its length.
    await page.evaluate(() => {
      const pw = document.createElement("input");
      pw.type = "password";
      pw.setAttribute("aria-label", "Password");
      pw.value = "PW-SECRET-hunter2";
      document.querySelector("form")!.append(pw);
    });
    const sn = await attach(page, { tree: "native" });

    // Snapshot helpers are opt-in, so committed snapshots don't churn.
    expect(await sn.treeSnapshot()).not.toContain("Ada Lovelace");

    const withValues = await sn.treeSnapshot({ values: true });
    expect(withValues).toContain('textbox "Full name" = "Ada Lovelace"');
    expect(withValues).toContain('textbox "Password" = "[redacted]"');
    expect(withValues).not.toContain("PW-SECRET");
    expect(withValues).not.toContain("•");

    const strict = await (
      await attach(page, { tree: "native", redactInput: true })
    ).treeSnapshot({ values: true });
    expect(strict).toMatch(/textbox "Full name"( \[focused\])?\n/);
    expect(strict).not.toContain("Ada Lovelace");
    expect(strict).not.toContain("[redacted]");
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
    const snapshot = await sn.treeSnapshot();
    expect(snapshot).toContain('textbox "Message to general"');
  });

  test("an editable (contenteditable) combobox serializes as a combobox (Slack search)", async ({
    page,
  }) => {
    const sn = await attach(page);
    const snapshot = await sn.treeSnapshot();
    expect(snapshot).toContain('combobox "Search"');
  });

  test("native mode shows what was typed into the message box, and redactInput withholds it", async ({
    page,
  }) => {
    // Quill keeps the draft in the editor's own <p>, as every model-driven
    // editor does. A screen reader reads that draft, so native mode shows it
    // by default (ADR-0001) — as the box's value and in the paragraph inside.
    // The strict mode (the CLI's --redact-input, MCP's
    // REAL_A11Y_REDACT_INPUT) withholds all of it.
    await page.evaluate(() => {
      document.querySelector(
        '[aria-label="Message to general"] p',
      )!.textContent = "draft EDITOR-SECRET";
    });

    const native = await (
      await attach(page, { tree: "native" })
    ).treeSnapshot({ values: true });
    expect(native).toContain(
      'textbox "Message to general" = "draft EDITOR-SECRET"',
    );

    const strict = await (
      await attach(page, { tree: "native", redactInput: true })
    ).treeSnapshot({ values: true });
    expect(strict).toContain('textbox "Message to general"');
    expect(strict).not.toContain("EDITOR-SECRET");

    // The DOM tree is the developer inspecting their own page: no strict mode.
    expect(await (await attach(page)).treeSnapshot()).toContain(
      "EDITOR-SECRET",
    );
    await expect(attach(page, { redactInput: true })).rejects.toThrow(
      /tree: "native"/,
    );
  });

  test("a native <input role=combobox> serializes as a combobox (W3C APG example shape)", async ({
    page,
  }) => {
    const sn = await attach(page);
    const snapshot = await sn.treeSnapshot();
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
    const snapshot = await sn.treeSnapshot();
    expect(snapshot).toContain("CSP page");
  });
});

test.describe("a page whose named elements shadow DOM methods", () => {
  // `Document` and `<form>` have [LegacyOverrideBuiltIns]: `<img
  // name="getElementById">` makes `document.getElementById` the image, and
  // `<input name="getAttribute">` makes `form.getAttribute` the input. jsdom
  // does not implement that override, so core's unit tests simulate it; this
  // is Chromium's.
  test("names a control through aria-labelledby when the document's getElementById is shadowed", async ({
    page,
  }) => {
    // Every aria-labelledby / -describedby element on the page was dropped.
    await page.setContent(`<main>
      <img name="getElementById" alt="">
      <span id="lbl">Save draft</span>
      <button aria-labelledby="lbl">x</button>
    </main>`);
    const sn = await attach(page);
    expect(await sn.treeSnapshot()).toContain('button "Save draft"');
  });

  test("extracts at all when the document's querySelectorAll is shadowed", async ({
    page,
  }) => {
    await page.setContent(
      `<main><img name="querySelectorAll" alt=""><button>Go</button></main>`,
    );
    const sn = await attach(page);
    expect(await sn.treeSnapshot()).toContain('button "Go"');
  });

  test("extracts a subtree when a form elsewhere shadows its own getAttribute", async ({
    page,
  }) => {
    // A `<form role="search">` is an overlay-scan candidate for any root that
    // is not the whole page; one that cannot be read aborted the extraction.
    await page.setContent(`
      <form role="search"><input name="getAttribute" aria-label="Query"></form>
      <main id="app"><button>Go</button></main>`);
    const sn = await attach(page, { rootSelector: "#app" });
    expect(await sn.treeSnapshot()).toContain('button "Go"');
  });
});

test.describe("rootSelector that matches nothing", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(fixtureUrl("fixture.html"));
  });

  test("treeSnapshot rejects instead of silently auditing the whole body", async ({
    page,
  }) => {
    const sn = await attach(page, { rootSelector: "#does-not-exist" });
    await expect(sn.treeSnapshot()).rejects.toThrow(/#does-not-exist/);
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

// ─── iframe content ──────────────────────────────────────────────────────────

test.describe("iframe content", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(fixtureUrl("fixture-iframe-host.html"));
  });

  test("a host-page audit does NOT see inside the iframe", async ({ page }) => {
    // The frame's unlabeled button would fail assertNoUnlabeledInteractive if it
    // were traversed — it isn't, so the host audit passes and the snapshot omits
    // the frame's content. This is the documented false-pass risk.
    const sn = await attach(page);
    await sn.assertNoUnlabeledInteractive(); // clean at the host level
    const snapshot = await sn.treeSnapshot();
    expect(snapshot).toContain("View cart");
    // The iframe itself appears (named by its title), but its *contents* don't.
    expect(snapshot).not.toContain("Payment details"); // the frame's <h1>
  });

  test("attaching to the Frame audits the iframe's own document", async ({
    page,
  }) => {
    const frame = page.frame({ name: "checkout" });
    expect(frame).not.toBeNull();
    const inner = await attach(frame!);
    // Now the frame's unlabeled button is in scope and gets caught.
    await expect(inner.assertNoUnlabeledInteractive()).rejects.toThrow(
      /unlabeled/i,
    );
    expect(await inner.treeSnapshot()).toContain("Payment details");
  });
});

// ─── navigation ──────────────────────────────────────────────────────────────

test.describe("navigation", () => {
  test("the handle keeps working after the page navigates", async ({
    page,
  }) => {
    await page.goto(fixtureUrl("fixture.html"));
    const sn = await attach(page);
    expect(await sn.treeSnapshot()).toContain("Test fixture");

    // The bundle lives on window and a navigation wipes it. attach() registered
    // an init script, so the new document re-injects it — no re-attach needed.
    await page.goto(fixtureUrl("fixture-iframe-host.html"));
    const after = await sn.treeSnapshot();
    expect(after).toContain("Store");
    expect(after).not.toContain("Test fixture");
  });
});

// ─── injected bundle hygiene ─────────────────────────────────────────────────

test.describe("injected bundle", () => {
  test("ships no sourceMappingURL (would 404 against the target page)", () => {
    // The bundle is injected as inline source, so a trailing
    // `//# sourceMappingURL=…` resolves relative to the page under test and
    // 404s. Assert on the bundle text — deterministic, and pretest:e2e just
    // rebuilt it.
    //
    // Reads the SOURCE, not a path: `@real-a11y-dev/browser` is private and
    // inlined into this package, so a path computed from its `import.meta.url`
    // would point inside THIS dist, where the file is not.
    expect(pageBundleSource()).not.toContain("sourceMappingURL");
  });
});
