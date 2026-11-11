/**
 * An `<input type="image">` is a button whose descendants are presentational
 * (WAI-ARIA 1.2 §5.2.9). Chromium still draws a user-agent image inside it
 * (`#alttext-image`), and the native producer used to keep that node: an
 * unnamed `img` under a correctly named button, and an `image-alt` finding
 * pointing into the control's shadow root, which no author can fix.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e image-input`
 */

import { collectFindings } from "@real-a11y-dev/audit";
import { BrowserSession } from "@real-a11y-dev/browser";
import { afterAll, describe, expect, it } from "vitest";

const GIF =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const FIXTURE = `<!doctype html><html><head><title>Image inputs</title></head><body>
  <main>
    <h1>Image inputs</h1>
    <input type="image" alt="Go" src="data:,">
    <input type="image" src="data:,">
    <input type="image" alt="Loaded" src="${GIF}">
    <img id="authored" src="data:,">
  </main>
</body></html>`;

const session = new BrowserSession({ headless: true });

afterAll(async () => {
  await session.close();
});

describe("image inputs — the UA image is not the page's", () => {
  it("keeps the UA image out of the native tree and its findings", async () => {
    await session.open("data:text/html," + encodeURIComponent(FIXTURE));
    const dom = await session.snapshot("body");
    const tree = await session.nativeTree();
    const native = collectFindings(tree);

    // No finding points into a control's shadow root.
    expect(native.map((f) => f.locator)).not.toContain("#alttext-image");

    const nodes = [...tree.nodes.values()];
    const buttons = nodes.filter((n) => n.a11y.role === "button");
    expect(buttons.map((b) => b.a11y.name)).toEqual(["Go", "Submit", "Loaded"]);

    // The only `img` left is the authored one, and it is still reported by
    // both producers.
    const images = nodes.filter((n) => n.a11y.role === "img");
    expect(images).toHaveLength(1);
    expect(images[0].dom?.locator).toBe("#authored");
    expect(
      native.filter((f) => f.rule === "image-alt").map((f) => f.locator),
    ).toEqual(["#authored"]);
    expect(
      dom.findings.filter((f) => f.rule === "image-alt").map((f) => f.locator),
    ).toContain("#authored");
  });
});
