/**
 * A native finding must say *where*, and say it the same way a DOM finding does.
 *
 * `audit` is documented as rule · severity · locator, but the DOM producer
 * derives the locator from a live `Element` held in an in-page WeakMap — which
 * the native producer, running in Node over a CDP snapshot, has no access to.
 * Before this, every `--producer native` finding came back with no locator at
 * all: a real defect with no address. The fix computes the locator during the
 * native producer's existing `DOM.getDocument` walk, using the same shared
 * builder the DOM producer uses.
 *
 * So this test runs BOTH producers over one fixture in real Chromium and
 * asserts the locators are identical — parity, not just presence. A locator
 * that exists but points somewhere else would be worse than none.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e`
 */

import { collectFindings } from "@real-a11y-dev/audit";
import { BrowserSession } from "@real-a11y-dev/browser";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Every branch of the path builder, in one page:
 *   - `#go`         — the element's own id short-circuits the walk
 *   - unique tag    — no `nth-of-type` noise when there's nothing to disambiguate
 *   - ancestor id   — the walk stops at `#panel` instead of running to <body>
 *   - same-tag kin  — 1-based `nth-of-type` among siblings of that tag only
 *   - shadow root   — a boundary the native walk crosses and a CSS path can't
 */
const FIXTURE = `<!doctype html><html><head><title>Locators</title></head><body>
  <main>
    <h1>Locators</h1>
    <button id="go"></button>
    <img src="a.png">
    <section id="panel"><div><img src="b.png"></div></section>
    <p><span></span><img src="c.png"><img src="d.png"></p>
    <div id="host"></div>
  </main>
  <script>
    document
      .getElementById("host")
      .attachShadow({ mode: "open" })
      .innerHTML = "<span></span><button></button>";
  </script>
</body></html>`;

const session = new BrowserSession({ headless: true });

afterAll(async () => {
  await session.close();
});

/** `rule @ locator`, sorted — the pairing that makes a finding actionable. */
function addressed(findings: { rule: string; locator?: string }[]): string[] {
  return findings
    .map((f) => `${f.rule} @ ${f.locator ?? "(none)"}`)
    .sort((a, b) => a.localeCompare(b));
}

describe("native producer — findings carry locators", () => {
  it("addresses every finding the same way the DOM producer does", async () => {
    await session.open("data:text/html," + encodeURIComponent(FIXTURE));

    const dom = await session.snapshot("body");
    const native = collectFindings(await session.nativeTree());

    // Guard the premise: a fixture that produced no findings would make every
    // assertion below vacuously true.
    expect(dom.findings.length).toBeGreaterThan(0);

    const nativeAddressed = addressed(native);
    console.log(
      ["", "===== NATIVE LOCATORS =====", ...nativeAddressed].join("\n"),
    );

    // No finding may come back unaddressed.
    expect(nativeAddressed.filter((line) => line.endsWith("(none)"))).toEqual(
      [],
    );

    // Every address the DOM producer computed, the native producer computes
    // identically. Subset rather than equality: the two producers legitimately
    // disagree on which nodes exist (Chromium surfaces UA-shadow controls no
    // in-page walk can see), and that divergence is the parity harness's job.
    const nativeSet = new Set(nativeAddressed);
    for (const line of addressed(dom.findings)) {
      expect(nativeSet, `native producer lost: ${line}`).toContain(line);
    }

    // And the addresses are real paths, not just non-empty strings.
    const locators = native.map((f) => f.locator);
    expect(locators).toContain("#go");
    expect(locators).toContain("body > main > img");
    expect(locators).toContain("#panel > div > img");
    expect(locators).toContain("body > main > p > img:nth-of-type(1)");
    expect(locators).toContain("body > main > p > img:nth-of-type(2)");
  });

  it("stops a path at a shadow boundary instead of faking a selector", async () => {
    await session.open("data:text/html," + encodeURIComponent(FIXTURE));
    const native = collectFindings(await session.nativeTree());

    // The unlabeled button inside the shadow root is native-only — the in-page
    // walk never sees it — and it has no whole-document CSS path. It must still
    // be addressed, but with an honest partial path.
    const shadowButton = native.find(
      (f) => f.rule === "no-unlabeled-interactive" && f.locator !== "#go",
    );
    expect(shadowButton?.locator).toBe("button");

    // Nothing may print a node kind that isn't an element: those read as
    // selectors and match nothing.
    for (const f of native) {
      expect(f.locator).not.toContain("#document");
    }
  });
});
