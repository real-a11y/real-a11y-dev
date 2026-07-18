/**
 * IIFE page-bundle entry — compiled to `dist/page-bundle.iife.js`.
 *
 * This bundle is injected into the browser page by the Playwright (and future
 * WebdriverIO) adapters via `page.addScriptTag()`. It sets
 * `window.__realA11y__` with the snapshot and assertion helpers so the adapter
 * can call them via `page.evaluate()`.
 *
 * Keep this file minimal: only include what needs to run _inside the page_.
 * Do NOT import Node-only modules here.
 */

export {
  serializeTree as auditSnapshot,
  serializeOutline as outlineSnapshot,
  serializeTabSequence as tabSequenceSnapshot,
} from "@real-a11y-dev/serialize";

export {
  assertNoUnlabeledInteractive,
  assertHeadingOrder,
  assertDialogsLabeled,
  assertLandmarkStructure,
  A11yAssertionError,
  collectFindings,
  listByRole,
} from "@real-a11y-dev/audit";

export {
  extractA11yTree,
  findByRole,
  findAllByRole,
  getOutline,
  getTabSequence,
  linearize,
} from "@real-a11y-dev/core";
