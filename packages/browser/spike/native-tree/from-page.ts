/**
 * SPIKE — Playwright Page → native ExtractionResult.
 *
 * This is the shape `@real-a11y-dev/browser`'s future `nativeTree(page)` will
 * take, and what `@real-a11y-dev/testing/playwright`'s `attach({ tree: "native" })`
 * will call. Not a public API.
 */

import type { ExtractionResult } from "@real-a11y-dev/core";
import type { CDPSession, Page } from "playwright";

import {
  normalizeNativeTree,
  type DomEnrichment,
  type SpikeAXNode,
} from "./normalize.js";

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
      // UA-shadow / pseudo nodes often fail resolve — expected.
    }
  }
  return out;
}

/** Spike-local serializer — `serializeTree` needs a DOM `Element` global. */
export function serializeExtraction(
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
      const label = `${node.a11y.role}${name ? ` "${name}"` : ""}${
        level ? ` (level ${level})` : ""
      }`;
      lines.push(`${"  ".repeat(printedAncestors)}${label}`);
      nextDepth = printedAncestors + 1;
    }
    for (const cid of node.childIds) walk(cid, nextDepth);
  };
  if (tree.rootId) walk(tree.rootId, 0);
  return lines.join("\n");
}

export interface NativeFromPageResult {
  tree: ExtractionResult;
  serialized: string;
  chromeVersion: string;
  axNodeCount: number;
  enrichedCount: number;
}

/**
 * Read Chromium's AX tree for `page` and normalize to ExtractionResult.
 * Mirrors the future `browser.nativeTree(page)` entry point.
 */
export async function nativeTreeFromPage(
  page: Page,
): Promise<NativeFromPageResult> {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Accessibility.enable");
    const full = (await client.send("Accessibility.getFullAXTree")) as {
      nodes: SpikeAXNode[];
    };
    const chromeVersion = page.context().browser()?.version() ?? "unknown";
    const enrichment = await enrichFromDom(client, full.nodes);
    const tree = normalizeNativeTree(full.nodes, {
      enrichmentByBackendId: enrichment,
      chromeVersion,
    });
    return {
      tree,
      serialized: serializeExtraction(tree),
      chromeVersion,
      axNodeCount: full.nodes.length,
      enrichedCount: enrichment.size,
    };
  } finally {
    await client.detach().catch(() => {});
  }
}
