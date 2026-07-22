/**
 * SPIKE — attach()-shaped handle that uses the *native* producer.
 *
 * Proves `@real-a11y-dev/testing/playwright` can consume CDP/native without
 * a separate Playwright package: producer stays in browser (spike:
 * `nativeTreeFromPage`), consumer is this thin adapter.
 *
 *   pnpm --filter @real-a11y-dev/testing run test:spike
 */

import type { Page } from "playwright";

import {
  nativeTreeFromPage,
  serializeExtraction,
} from "../../../browser/spike/native-tree/from-page.js";
import { attach } from "../../src/playwright.js";

export type TreeMode = "dom" | "native";

export interface SpikeAttachOptions {
  rootSelector?: string;
  /**
   * `"native"` (CDP / Blink AX) or `"dom"` (today's page-bundle inject).
   * Product default after Phase 1 gates: `"native"`.
   */
  tree?: TreeMode;
}

export interface SpikePageHandle {
  /** Producer used for this handle — stamp into snapshots in product code. */
  readonly producer: TreeMode;
  auditSnapshot(): Promise<string>;
  /** DOM-mode-only helpers still available when tree === "dom". */
  assertHeadingOrder?(): Promise<void>;
}

/**
 * Spike stand-in for `attach(page, { tree })`.
 * - native → `browser` CDP path (no page-bundle)
 * - dom → real `attach()` from `testing/playwright`
 */
export async function attachSpike(
  page: Page,
  options: SpikeAttachOptions = {},
): Promise<SpikePageHandle> {
  const mode: TreeMode = options.tree ?? "native";
  const rootSelector = options.rootSelector ?? "body";

  if (mode === "dom") {
    const handle = await attach(page, { rootSelector });
    return {
      producer: "dom",
      auditSnapshot: () => handle.auditSnapshot(),
      assertHeadingOrder: () => handle.assertHeadingOrder(),
    };
  }

  // Native path: no page-bundle injection. CDP only.
  // rootSelector scoping is deferred (whole-document AX in this spike).
  if (rootSelector !== "body") {
    throw new Error(
      "spike attachSpike({ tree: 'native' }): rootSelector scoping not implemented yet",
    );
  }

  return {
    producer: "native",
    async auditSnapshot() {
      const { serialized } = await nativeTreeFromPage(page);
      return serialized;
    },
  };
}

export { serializeExtraction, nativeTreeFromPage };
