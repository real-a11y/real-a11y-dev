// @vitest-environment node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("./tree.css", import.meta.url)),
  "utf8",
);

/**
 * Every `@keyframes <name>` block in the stylesheet, in source order, as
 * `[name, body]`. A later block with the same name shadows the earlier one —
 * that is what these tests exist to catch.
 */
function keyframeBlocks(): Array<[name: string, body: string]> {
  const blocks: Array<[string, string]> = [];
  const header = /@keyframes\s+([\w-]+)\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = header.exec(css)) !== null) {
    // Walk braces from the opening one so nested `0% { … }` steps stay inside.
    let depth = 1;
    let i = header.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    blocks.push([match[1]!, css.slice(header.lastIndex, i - 1)]);
    header.lastIndex = i;
  }

  return blocks;
}

/** The `animation` shorthand's keyframes name for a single-class rule. */
function animationNameOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(rule, `no rule found for ${selector}`).not.toBeNull();
  const animation = /animation:\s*([\w-]+)/.exec(rule![1]!);
  expect(animation, `${selector} declares no animation`).not.toBeNull();
  return animation![1]!;
}

/** The definition that actually applies: the last one to declare the name. */
function effectiveKeyframes(name: string): string {
  const matching = keyframeBlocks().filter(([n]) => n === name);
  expect(matching.length, `no @keyframes ${name}`).toBeGreaterThan(0);
  return matching[matching.length - 1]![1];
}

describe("tree.css animations", () => {
  it("declares each @keyframes name exactly once", () => {
    const seen = new Map<string, number>();
    for (const [name] of keyframeBlocks()) {
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }
    const duplicated = [...seen].filter(([, count]) => count > 1);
    expect(duplicated).toEqual([]);
  });

  it("flashes the accent background on a row a cross-link jump lands on", () => {
    // The row is already in place; it must tint and fade, never move.
    const body = effectiveKeyframes(animationNameOf(".sn-node--flash"));
    expect(body).toMatch(/background:/);
    expect(body).not.toMatch(/transform:/);
  });

  it("slides the action-feedback banner in from below", () => {
    const body = effectiveKeyframes(
      animationNameOf(".sn-action-feedback-text"),
    );
    expect(body).toMatch(/transform:\s*translateY/);
  });
});
