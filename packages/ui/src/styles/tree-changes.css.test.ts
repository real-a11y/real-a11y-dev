// @vitest-environment node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * What the change marks' stylesheet must keep true that no render shows in
 * jsdom: a flash that starts over looks the same as the first, a jump keeps
 * the flash it lands on running, and reduced motion stills every flash.
 */

const css = readFileSync(
  fileURLToPath(new URL("./tree-changes.css", import.meta.url)),
  "utf8",
);

/** Every `@keyframes <name>` block, as name to body. */
function keyframes(): Map<string, string> {
  const blocks = new Map<string, string>();
  const header = /@keyframes\s+([\w-]+)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = header.exec(css)) !== null) {
    let depth = 1;
    let i = header.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    expect(blocks.has(match[1]!), `@keyframes ${match[1]} twice`).toBe(false);
    blocks.set(match[1]!, css.slice(header.lastIndex, i - 1).trim());
    header.lastIndex = i;
  }
  return blocks;
}

/** The declarations of the rule whose selector list is exactly `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // After the rule before it, or a comment.
  const rule = new RegExp(`(?:^|\\}|\\*/)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(
    css,
  );
  expect(rule, `no rule for ${selector}`).not.toBeNull();
  return rule![1]!;
}

describe("tree-changes.css", () => {
  it.each(["new", "changed", "part"])(
    "starts a %s flash over with the same frames as the first",
    (kind) => {
      const frames = keyframes();
      const name =
        kind === "part" ? "sn-change-part-flash" : `sn-change-${kind}-flash`;
      expect(frames.get(`${name}-alt`)).toBe(frames.get(name));
    },
  );

  it.each(["new", "changed"])(
    "keeps a %s row's flash under the jump that lands on it, the jump drawn last",
    (kind) => {
      const first = ruleBody(
        `.sn-node--flash.sn-node--change-flash.sn-node--change-${kind}`,
      );
      expect(first.replace(/\s+/g, " ")).toMatch(
        new RegExp(
          `animation: sn-change-${kind}-flash [^,]+, sn-node-flash 700ms`,
        ),
      );
      const again = ruleBody(
        `.sn-node--flash.sn-node--change-flash-alt.sn-node--change-${kind}`,
      );
      expect(again.replace(/\s+/g, " ")).toContain(
        `animation-name: sn-change-${kind}-flash-alt, sn-node-flash;`,
      );
    },
  );

  it("stills every flash under reduced motion", () => {
    const reduced =
      /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css);
    expect(reduced).not.toBeNull();
    const stilled = /([^{}]+)\{\s*animation: none;\s*\}/.exec(reduced![1]!);
    expect(stilled).not.toBeNull();
    const selectors = stilled![1]!.split(",").map((s) => s.trim());
    expect(selectors).toEqual(
      expect.arrayContaining([
        ".sn-node--change-flash.sn-node--change-new",
        ".sn-node--change-flash.sn-node--change-changed",
        ".sn-node--flash.sn-node--change-flash.sn-node--change-new",
        ".sn-node--flash.sn-node--change-flash.sn-node--change-changed",
        ".sn-node--change-flash .sn-change-part",
        ".sn-change-tag--flash",
      ]),
    );
  });
});
