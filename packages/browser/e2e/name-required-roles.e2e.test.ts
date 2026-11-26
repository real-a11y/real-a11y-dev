/**
 * WAI-ARIA 1.2 requires an accessible name for treeitem, tooltip, meter and
 * progressbar. The `no-unlabeled-interactive` rule reports all four unnamed,
 * on both the in-page DOM path and the native (CDP) path, and reports an
 * unnamed img / dialog only once, from their own rules.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e name-required-roles`
 */

import { collectFindings } from "@real-a11y-dev/audit";
import { BrowserSession } from "@real-a11y-dev/browser";
import { afterAll, describe, expect, it } from "vitest";

const FIXTURE = `<!doctype html><html><head><title>t</title></head><body><main>
  <h1>t</h1>
  <div role="tree"><div role="treeitem"></div></div>
  <div role="tooltip"></div>
  <div role="meter" aria-valuenow="1"></div>
  <div role="progressbar"></div>
  <img src="a.png">
  <div role="dialog"></div>
</main></body></html>`;

const session = new BrowserSession({ headless: true });

afterAll(async () => {
  await session.close();
});

const roles = (f: { rule: string; role?: string }[]): string[] =>
  f
    .filter((x) => x.rule === "no-unlabeled-interactive")
    .map((x) => x.role ?? "")
    .sort();

describe("name-required roles", () => {
  it("flags the four roles on both producers", async () => {
    await session.open("data:text/html," + encodeURIComponent(FIXTURE));
    const dom = await session.snapshot("body");
    const native = collectFindings(await session.nativeTree());
    const want = ["meter", "progressbar", "tooltip", "treeitem"];
    expect(roles(dom.findings)).toEqual(want);
    expect(roles(native)).toEqual(want);
    for (const f of [dom.findings, native]) {
      expect(f.filter((x) => x.rule === "image-alt")).toHaveLength(1);
      expect(f.filter((x) => x.rule === "dialog-labeled")).toHaveLength(1);
    }
  });
});
