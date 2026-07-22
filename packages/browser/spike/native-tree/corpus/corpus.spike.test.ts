/**
 * SPIKE 4 — real-app HTML/ARIA corpus: native vs DOM producer parity.
 *
 * Media was the forcing function; this spike asks whether native mode is
 * credible across everyday app-shell patterns (landmarks, forms, tables,
 * ARIA widgets, author shadow DOM).
 *
 *   pnpm --filter @real-a11y-dev/browser run test:spike
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PAGE_BUNDLE_PATH } from "../../../dist/index.js";

import { nativeTreeFromPage } from "../from-page.js";

import {
  diffPairs,
  EXPECTED_SHARED_ROLE_PREFIXES,
  type ParityReport,
} from "./parity.js";

const here = dirname(fileURLToPath(import.meta.url));
const corpusHtml = readFileSync(join(here, "app-shell.html"), "utf8");
const pageBundle = readFileSync(PAGE_BUNDLE_PATH, "utf8");

async function domAuditSnapshot(page: Page): Promise<string> {
  await page.evaluate(pageBundle);
  return page.evaluate(() => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      auditSnapshot: (root: Element, opts?: { markFocus?: boolean }) => string;
    };
    return ra.auditSnapshot(document.body, { markFocus: false });
  });
}

function hasRole(pairs: string[], role: string): boolean {
  const r = role.toLowerCase();
  return pairs.some((p) => {
    const base = p.replace(/\s*\(level\s+\d+\)\s*$/i, "").trim();
    return base === r || base.startsWith(`${r} "`);
  });
}

describe("corpus parity spike (real-app HTML/ARIA)", () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  let page: Page;
  let nativeTree: string;
  let domTree: string;
  let report: ParityReport;
  let dialogNative: string;
  let dialogDom: string;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.setContent(corpusHtml, { waitUntil: "load" });

    // Full app shell — dialog closed (modal would inert the rest of the page).
    const native = await nativeTreeFromPage(page);
    nativeTree = native.serialized;
    domTree = await domAuditSnapshot(page);
    report = diffPairs(nativeTree, domTree);

    // Modal pass — real apps often show one dialog at a time.
    await page.locator("#open-dialog").click();
    dialogNative = (await nativeTreeFromPage(page)).serialized;
    dialogDom = await domAuditSnapshot(page);
    await page.keyboard.press("Escape");
  }, 60_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  it("native tree covers core app-shell roles (not just media)", () => {
    const pairs = nativeTree
      .split("\n")
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean);

    // Landmark role names vary slightly (banner vs header); accept either.
    const hasLandmark = (names: string[]) =>
      names.some((n) => hasRole(pairs, n));

    expect(
      hasLandmark(["banner", "header"]),
      "native landmark header/banner",
    ).toBe(true);
    expect(hasLandmark(["navigation", "nav"]), "native nav").toBe(true);
    expect(hasLandmark(["main"]), "native main").toBe(true);

    for (const role of [
      "heading",
      "button",
      "link",
      "textbox",
      "checkbox",
      "radio",
      "list",
      "img",
      "tab",
      "switch",
      "alert",
    ]) {
      expect(hasRole(pairs, role), `native missing role: ${role}`).toBe(true);
    }
  });

  it("DOM producer also covers the same core roles (baseline sanity)", () => {
    const pairs = domTree
      .split("\n")
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean);
    for (const role of [
      "main",
      "heading",
      "button",
      "link",
      "textbox",
      "tab",
    ]) {
      expect(hasRole(pairs, role), `dom missing role: ${role}`).toBe(true);
    }
  });

  it("author open-shadow button is visible to at least one producer", () => {
    const hit =
      /shadow action/i.test(nativeTree) || /shadow action/i.test(domTree);
    expect(hit).toBe(true);
  });

  it("native uniquely surfaces media UA controls (forcing function still holds)", () => {
    expect(nativeTree).toMatch(/button "play"/i);
    expect(domTree).not.toMatch(/button "play"/i);
  });

  it("open dialog scopes both producers to the modal (real-app modality)", () => {
    expect(dialogNative.toLowerCase()).toMatch(/dialog/);
    expect(dialogDom.toLowerCase()).toMatch(/dialog/);
    // Background chrome should drop out (or largely) while modal is open.
    expect(dialogNative.toLowerCase()).not.toMatch(/navigation "primary"/);
    expect(dialogDom.toLowerCase()).not.toMatch(/navigation "primary"/);
  });

  it("shared role+name pairs dominate — corpus is mostly comparable", () => {
    // Soft gate: majority of DOM pairs should also appear in native (native
    // may have *more* because of media controls / Chromium extras).
    const overlap = report.shared.length / Math.max(report.domCount, 1);
    expect(overlap).toBeGreaterThan(0.5);

    console.log(
      [
        "",
        "===== CORPUS PARITY =====",
        `dom pairs: ${report.domCount}  native pairs: ${report.nativeCount}  shared: ${report.shared.length}`,
        `overlap vs dom: ${(overlap * 100).toFixed(1)}%`,
        "",
        `only-native (${report.onlyNative.length}):`,
        ...report.onlyNative.slice(0, 40).map((p) => `  + ${p}`),
        report.onlyNative.length > 40
          ? `  … +${report.onlyNative.length - 40} more`
          : "",
        "",
        `only-dom (${report.onlyDom.length}):`,
        ...report.onlyDom.slice(0, 40).map((p) => `  - ${p}`),
        report.onlyDom.length > 40
          ? `  … +${report.onlyDom.length - 40} more`
          : "",
        "",
        "===== NATIVE (excerpt) =====",
        nativeTree.split("\n").slice(0, 50).join("\n"),
        "",
        "===== DOM (excerpt) =====",
        domTree.split("\n").slice(0, 50).join("\n"),
      ]
        .filter((l) => l !== undefined)
        .join("\n"),
    );
  });

  it("expected shared role prefixes appear on both sides when present in corpus HTML", () => {
    const nativePairs = nativeTree
      .split("\n")
      .map((l) => l.trim().toLowerCase());
    const domPairs = domTree.split("\n").map((l) => l.trim().toLowerCase());
    const missing: string[] = [];
    for (const role of EXPECTED_SHARED_ROLE_PREFIXES) {
      // table/combobox/contentinfo vary by engine naming — warn via list, don't fail all
      const n = hasRole(nativePairs, role);
      const d = hasRole(domPairs, role);
      if (n && d) continue;
      if (!n && !d) continue; // neither mapped this role — vocabulary gap elsewhere
      missing.push(`${role}: native=${n} dom=${d}`);
    }

    console.log("role-prefix asymmetries:", missing.join("; ") || "(none)");
    // Soft: allow some asymmetries (table vs grid, combobox naming) but not a wipeout.
    expect(missing.length).toBeLessThan(8);
  });
});
