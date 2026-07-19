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
