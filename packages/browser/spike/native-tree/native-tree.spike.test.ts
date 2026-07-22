/**
 * SPIKE test — launches Chromium, builds native ExtractionResult, compares to
 * the DOM-producer serialize output. Not part of the default `vitest` suite.
 *
 *   pnpm --filter @real-a11y-dev/browser run test:spike
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExtractionResult } from "@real-a11y-dev/core";
import { chromium, type CDPSession, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  normalizeNativeTree,
  type DomEnrichment,
  type SpikeAXNode,
} from "./normalize.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(join(here, "fixture.html"), "utf8");

/** serializeTree uses `instanceof Element`, which throws in plain Node. Spike-local. */
function serializeExtraction(
  tree: ExtractionResult,
  opts: { includeGeneric?: boolean } = {},
): string {
  const includeGeneric = opts.includeGeneric ?? false;
  const lines: string[] = [];
  const walk = (id: string, printedAncestors: number) => {
    const node = tree.nodes.get(id);
    if (!node) return;
    const skip = !includeGeneric && node.a11y.role === "generic";
    let nextDepth = printedAncestors;
    if (!skip) {
      const name = node.a11y.name;
      const level = node.a11y.properties?.level;
      const label = `${node.a11y.role}${name ? ` "${name}"` : ""}${level ? ` (level ${level})` : ""}`;
      lines.push(`${"  ".repeat(printedAncestors)}${label}`);
      nextDepth = printedAncestors + 1;
    }
    for (const cid of node.childIds) walk(cid, nextDepth);
  };
  if (tree.rootId) walk(tree.rootId, 0);
  return lines.join("\n");
}

async function enrichFromDom(
  client: CDPSession,
  axNodes: SpikeAXNode[],
): Promise<Map<number, DomEnrichment>> {
  await client.send("DOM.enable");
  await client.send("DOM.getDocument", { depth: 0 });

  const backendIds = [
    ...new Set(
      axNodes
        .map((n) => n.backendDOMNodeId)
        .filter((id): id is number => typeof id === "number"),
    ),
  ];

  const out = new Map<number, DomEnrichment>();
  // Batch resolve — CDP allows one backend id per resolveNode call.
  for (const backendNodeId of backendIds) {
    try {
      const resolved = (await client.send("DOM.resolveNode", {
        backendNodeId,
      })) as { object?: { objectId?: string } };
      const objectId = resolved.object?.objectId;
      if (!objectId) continue;
      const evaled = (await client.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: `function () {
          const el = this;
          if (!el || !el.tagName) {
            return { tagName: null, id: null, type: null, value: null, autocomplete: null };
          }
          return {
            tagName: el.tagName,
            id: el.id || null,
            type: el.type || null,
            value: el.value !== undefined ? String(el.value) : null,
            autocomplete: el.getAttribute ? el.getAttribute("autocomplete") : null,
          };
        }`,
        returnByValue: true,
      })) as { result?: { value?: DomEnrichment } };
      if (evaled.result?.value) out.set(backendNodeId, evaled.result.value);
    } catch {
      // Some backend ids are UA-shadow / pseudo and fail resolve — expected.
    }
  }
  return out;
}

describe("native-tree spike", () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  let page: Page;
  let client: CDPSession;
  let axNodes: SpikeAXNode[];
  let chromeVersion: string;
  let enrichment: Map<number, DomEnrichment>;
  let nativeTree: string;
  let domTree: string;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.setContent(fixtureHtml, { waitUntil: "load" });

    client = await page.context().newCDPSession(page);
    await client.send("Accessibility.enable");
    const full = (await client.send("Accessibility.getFullAXTree")) as {
      nodes: SpikeAXNode[];
    };
    axNodes = full.nodes;
    chromeVersion = browser.version();
    enrichment = await enrichFromDom(client, axNodes);

    const extraction = normalizeNativeTree(axNodes, {
      enrichmentByBackendId: enrichment,
      chromeVersion,
    });
    nativeTree = serializeExtraction(extraction, {
      includeGeneric: false,
    });

    // DOM producer via the same page (injected serialize path would need the
    // page-bundle; for the spike, evaluate a minimal role dump is enough to
    // show the media gap — we compare structural presence, not byte equality).
    domTree = await page.evaluate(() => {
      // Lightweight DOM-side sketch: what light DOM exposes for media.
      const video = document.querySelector("video");
      const audio = document.querySelector("audio");
      const lines: string[] = [];
      lines.push(`heading "Spike fixture" (level 1)`);
      lines.push(`button "Save"`);
      lines.push(`textbox "Password"`);
      lines.push(`textbox "Email"`);
      lines.push(
        `video${video ? "" : " (missing)"} — light DOM: childElementCount=${video?.childElementCount ?? 0}, shadowRoot=${video?.shadowRoot ? "open" : "null"}`,
      );
      lines.push(
        `audio${audio ? "" : " (missing)"} — light DOM: childElementCount=${audio?.childElementCount ?? 0}, shadowRoot=${audio?.shadowRoot ? "open" : "null"}`,
      );
      return lines.join("\n");
    });
  }, 60_000);

  afterAll(async () => {
    await client?.detach().catch(() => {});
    await browser?.close().catch(() => {});
  });

  it("getFullAXTree returns Video/Audio with control children (forcing function)", () => {
    const roles = axNodes.map((n) => n.role?.value ?? "");
    expect(roles).toContain("Video");
    expect(roles).toContain("Audio");

    // Controls live under Video even when nested through ignored wrappers.
    const names = axNodes
      .filter((n) => !n.ignored)
      .map((n) => n.name?.value?.trim() ?? "");
    expect(names).toEqual(
      expect.arrayContaining([
        "play",
        "mute",
        "enter full screen",
        "video time scrubber",
      ]),
    );
  });

  it("normalizer emits SemanticNodes that serializeTree accepts", () => {
    expect(nativeTree.length).toBeGreaterThan(0);
    expect(nativeTree).toMatch(/heading "Spike fixture"/);
    expect(nativeTree).toMatch(/button "Save"/);
    expect(nativeTree).toMatch(/video/);
    expect(nativeTree).toMatch(/button "play"/);
    expect(nativeTree).toMatch(/slider "video time scrubber"/);
    // Noise roles must not appear as printed lines
    expect(nativeTree).not.toMatch(/\bInlineTextBox\b/);
    expect(nativeTree).not.toMatch(/\bStaticText\b/);
  });

  it("password AX value is masked by Chromium; DOM enrich still sees plaintext (redaction gate)", () => {
    const pwAx = axNodes.find(
      (n) =>
        n.role?.value === "textbox" && /password/i.test(n.name?.value ?? ""),
    );
    expect(pwAx?.value?.value).toMatch(/•+/);

    const pwEnrich = enrichment.get(pwAx!.backendDOMNodeId!);
    expect(pwEnrich?.type).toBe("password");
    expect(pwEnrich?.value).toBe("s3cret-value"); // proves the leak surface

    // After normalize, sensitive state.value must be redacted
    const extraction = normalizeNativeTree(axNodes, {
      enrichmentByBackendId: enrichment,
      chromeVersion,
    });
    const pwNode = [...extraction.nodes.values()].find(
      (n) => n.a11y.role === "textbox" && /password/i.test(n.a11y.name),
    );
    expect(pwNode?.a11y.states.value).toBe("[redacted]");
    expect(pwNode?.dom.tagName).toBe("INPUT");
    expect(pwNode?.dom.attributes.type).toBe("password");
  });

  it("email AX value leaks plaintext — enrichment/redaction policy must cover non-password fields too", () => {
    const emailAx = axNodes.find(
      (n) => n.role?.value === "textbox" && /email/i.test(n.name?.value ?? ""),
    );
    expect(emailAx?.value?.value).toBe("user@example.com");
  });

  it("backendDOMNodeId resolves for author-DOM nodes (id stability path)", () => {
    const button = axNodes.find(
      (n) => n.role?.value === "button" && n.name?.value === "Save",
    );
    expect(button?.backendDOMNodeId).toEqual(expect.any(Number));
    const enrich = enrichment.get(button!.backendDOMNodeId!);
    expect(enrich?.tagName).toBe("BUTTON");
  });

  it("light DOM cannot see media control children (documents the gap)", () => {
    expect(domTree).toMatch(/shadowRoot=null/);
    expect(domTree).toMatch(/childElementCount=0/);
    // Native side has the controls
    expect(nativeTree).toMatch(/button "play"/);
  });

  it("prints a spike report artifact for the RFC", () => {
    // Visible in vitest output — also written by the run script.

    console.log(
      [
        "",
        "===== NATIVE TREE (normalized → serializeTree) =====",
        nativeTree,
        "",
        "===== DOM PRODUCER SKETCH (light DOM reality) =====",
        domTree,
        "",
        `chrome=${chromeVersion} axNodes=${axNodes.length} enriched=${enrichment.size}`,
      ].join("\n"),
    );
    expect(true).toBe(true);
  });
});
