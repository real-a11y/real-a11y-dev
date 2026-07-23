/**
 * End-to-end DOM↔native parity harness (RFC PR E).
 *
 * For each corpus page it loads real Chromium once and serializes it two ways —
 * the DOM producer (the injected page-bundle) and the native producer
 * (`BrowserSession.nativeTree()`, which reads Chromium's own AX tree over CDP)
 * — then measures how much of the DOM tree the native tree covers. This is the
 * gate the RFC requires before defaulting any surface to native: the producers
 * are never byte-identical, so we assert an overlap FLOOR (and log the actual)
 * rather than equality.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e`
 * (needs a Chromium binary: `pnpm exec playwright install chromium`).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserSession } from "@real-a11y-dev/browser";
import { serializeTree } from "@real-a11y-dev/serialize";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { computeParity } from "./parity.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The bar to beat, and the hard floor. Spike 4 measured ~89% role+name overlap
 * on the app-shell corpus; the product producers land in the same range. The
 * floor is set conservatively below the observed watermark so ordinary
 * Chromium-milestone drift doesn't flake the gate, while a real regression
 * (the native normalizer dropping a whole class of nodes) still trips it.
 * Tighten toward the watermark as the corpus and normalizer stabilize.
 */
const PARITY_FLOOR = 0.8;

/** Corpus of fixture pages. Grow this — iframes, portals, virtualized lists,
 *  contenteditable — per the RFC backlog; each new page tightens the gate. */
const CORPUS = [{ name: "app-shell", file: "app-shell.html" }] as const;

function dataUrl(html: string): string {
  return "data:text/html," + encodeURIComponent(html);
}

const session = new BrowserSession({ headless: true });

beforeAll(async () => {
  // Nothing global; each test opens its own page through the shared session.
});

afterAll(async () => {
  await session.close();
});

describe("DOM ↔ native parity (corpus)", () => {
  for (const page of CORPUS) {
    it(`covers the DOM tree on "${page.name}" (overlap ≥ ${PARITY_FLOOR})`, async () => {
      const html = readFileSync(join(here, "corpus", page.file), "utf8");
      await session.open(dataUrl(html));

      // DOM producer (page-bundle) and native producer (CDP), both serialized
      // to the same `role "name"` shape with no focus marker (native carries
      // none, so a marker on the DOM side would read as a spurious divergence).
      const domTree = await session.call<string>("auditSnapshot", "body", [
        { markFocus: false },
      ]);
      const native = await session.nativeTree();
      const nativeTree = serializeTree(native, { markFocus: false });

      const report = computeParity(domTree, nativeTree);

      // Always surface the breakdown so CI logs the watermark over time.
      console.log(
        [
          "",
          `===== PARITY: ${page.name} =====`,
          `dom pairs: ${report.domCount}  native pairs: ${report.nativeCount}  shared: ${report.shared}`,
          `overlap vs dom: ${(report.overlap * 100).toFixed(1)}%  (floor ${(PARITY_FLOOR * 100).toFixed(0)}%)`,
          report.onlyDom.length
            ? `only-dom (${report.onlyDom.length}): ${report.onlyDom.slice(0, 12).join(", ")}`
            : "only-dom: (none)",
          report.onlyNative.length
            ? `only-native (${report.onlyNative.length}): ${report.onlyNative.slice(0, 12).join(", ")}`
            : "only-native: (none)",
        ].join("\n"),
      );

      expect(native.source.producer).toBe("native");
      expect(report.overlap).toBeGreaterThanOrEqual(PARITY_FLOOR);
    });
  }
});
