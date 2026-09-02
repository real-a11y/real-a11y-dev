/**
 * IIFE page-bundle entry — compiled to `dist/page-bundle.iife.global.js`
 * (tsup appends `.global` because a `globalName` is set for the iife format).
 *
 * This bundle is injected into the browser page by `BrowserSession` and the
 * `@real-a11y-dev/testing/playwright` adapter via `page.addScriptTag()` /
 * `page.evaluate()`. It sets `window.__realA11y__` with the snapshot and
 * assertion helpers so the caller can invoke them by name inside the page.
 *
 * Keep this file minimal: only include what needs to run _inside the page_.
 * Do NOT import Node-only modules here.
 *
 * Every export is a **published surface** — a caller can evaluate the IIFE and
 * invoke `__realA11y__.<name>` directly, which is the documented path for a page
 * under a Trusted Types CSP. So an export nobody calls is not free: it ships
 * into every audited page forever and can't be withdrawn quietly.
 * `page-bundle.test.ts` pins the list against the consumers that dispatch on it,
 * so adding one is a decision rather than an import.
 */

export {
  serializeTree as treeSnapshot,
  serializeOutline as outlineSnapshot,
  serializeTabSequence as tabSequenceSnapshot,
} from "@real-a11y-dev/serialize";

// `listByRole` is deliberately NOT here. Both surfaces that list a category run
// it in Node over a native tree now (`real-a11y list`, the MCP's
// `list_elements`), and `@real-a11y-dev/testing` re-exports it for direct jsdom
// use — so the in-page copy had no caller at all. It cost 0.37 kB gzipped of
// every audited page.
export {
  assertNoUnlabeledInteractive,
  assertHeadingOrder,
  assertDialogsLabeled,
  assertLandmarkStructure,
  A11yAssertionError,
  collectFindings,
} from "@real-a11y-dev/audit";

export {
  extractA11yTree,
  findByRole,
  findAllByRole,
  getOutline,
  getTabSequence,
  linearize,
} from "@real-a11y-dev/core";

// Axis-A tree checkpoints. The captured tree stays in the page (node ids are
// realm-bound), so only the rendered diff crosses the evaluate() boundary.
export { checkpointTree, diffSinceCheckpoint } from "./tree-checkpoint.js";
