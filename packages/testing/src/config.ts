import { realmSingleton } from "@real-a11y-dev/core";

import type { A11yDiffOptions } from "./diff.js";

/** Project-wide defaults, set once with {@link configureA11y}. */
export interface A11yConfig {
  /**
   * Defaults for every diff this package prints: `a11yDiff`, and the text
   * `flow().expectChanges` compares a string against. A call's own options
   * win key by key, so `{ childIds: true }` in one call keeps the project's
   * `redact`. A call's `redact` replaces the project's list; `redact: []`
   * turns it off for that call.
   */
  diff?: A11yDiffOptions;
}

/**
 * Where the defaults live: one slot per realm, not module scope. This package
 * builds each entry in ESM and CJS, and CJS shares no chunk between entries,
 * so a default set through `@real-a11y-dev/testing/matchers` would never reach
 * an `a11yDiff` imported from `@real-a11y-dev/testing` in a Jest setup. Nothing
 * would error; the default would just not apply.
 */
const CONFIG_SHAPE = "testing-config@1";

const config = (): A11yConfig =>
  realmSingleton("testing.config", CONFIG_SHAPE, () => ({}));

/**
 * Set project-wide defaults, typically once in a test setup file. Each section
 * you name replaces that section's defaults; a section you leave out keeps
 * its own. `{ diff: {} }` clears the diff defaults.
 *
 * ```ts
 * configureA11y({ diff: { childIds: false, redact: [/\d{2}:\d{2}/] } });
 *
 * a11yDiff(before, root);                     // childIds: false, redact
 * a11yDiff(before, root, { childIds: true }); // this call only; still redacts
 * ```
 *
 * `registerA11yMatchers(expect, config)` from `@real-a11y-dev/testing/matchers`
 * calls this with its second argument.
 */
export function configureA11y(next: A11yConfig): void {
  if (!("diff" in next)) return;
  const diff = next.diff;
  // A copy: a pattern list the caller changes later doesn't move the defaults.
  config().diff = diff && {
    ...diff,
    redact: diff.redact && [...diff.redact],
  };
}

/**
 * The options a diff prints with: the call's own, then the project's for each
 * key the call leaves `undefined`.
 */
export function diffOptions(options: A11yDiffOptions = {}): A11yDiffOptions {
  const defaults = config().diff ?? {};
  return {
    redact: options.redact ?? defaults.redact,
    values: options.values ?? defaults.values,
    childIds: options.childIds ?? defaults.childIds,
  };
}
