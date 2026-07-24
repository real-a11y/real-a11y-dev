/**
 * Playwright adapter for @real-a11y-dev/testing.
 *
 * Separate entrypoint so bundlers don't pull `playwright` into consumers
 * that only use the jsdom/Vitest helpers.
 *
 * Architecture:
 *   1. `attach()` reads the pre-built IIFE page-bundle from
 *      `@real-a11y-dev/browser` (the single home for the injected bundle).
 *   2. Injects it into the Playwright page by evaluating its source, which
 *      sets `window.__realA11y__` inside the browser. Evaluating rather than
 *      appending a `<script>` keeps injection working on pages that ship a
 *      strict Content-Security-Policy (see `attach`).
 *   3. Returns a `SemanticNavigatorPageHandle` whose methods call
 *      `page.evaluate()`, routing each call through the injected bundle.
 *
 * Error propagation: when an assertion function throws inside the page,
 * Playwright re-throws it in Node with the original message preserved.
 */

import { readFileSync } from "node:fs";

import { assertRules } from "@real-a11y-dev/audit";
import { PAGE_BUNDLE_PATH, nativeTree } from "@real-a11y-dev/browser";
import { serializeTree, serializeOutline } from "@real-a11y-dev/serialize";

// ---------------------------------------------------------------------------
// Bundle path — the injected IIFE page-bundle lives in @real-a11y-dev/browser,
// which exports its absolute path (it computes it from its own dist location,
// so this works whether testing is run from src or dist, and avoids a fragile
// cross-package resolve of an ESM-only entry).
// ---------------------------------------------------------------------------

function getPageBundlePath(): string {
  return PAGE_BUNDLE_PATH;
}

// Cache the bundle content so subsequent `attach()` calls in the same
// process don't re-read the file.
let _cachedBundle: string | undefined;

function readBundle(): string {
  if (!_cachedBundle) {
    _cachedBundle = readFileSync(getPageBundlePath(), "utf8");
  }
  return _cachedBundle;
}

// ---------------------------------------------------------------------------
// Minimal structural types — consumers don't need to install playwright/
// @playwright/test to get correct types for the handle.
// ---------------------------------------------------------------------------

/**
 * Minimal structural type for a Playwright audit target. Accepts a real `Page`
 * — and also a `Frame`, which is how you audit iframe content (extraction never
 * descends into iframes; see `attach`).
 */
export type PlaywrightPage = {
  /**
   * Playwright accepts either a function (with an optional serialisable
   * argument) or a raw source string. The string form is how `attach` injects
   * the page bundle — see the CSP note there.
   */
  evaluate<R>(
    pageFunction: ((arg: unknown) => R) | string,
    arg?: unknown,
  ): Promise<R>;
  /**
   * Present on `Page`, absent on `Frame` — hence optional. When available,
   * `attach` uses it to re-inject the bundle into every future document, so the
   * handle survives navigation.
   */
  addInitScript?(script: { content: string }): Promise<unknown>;
};

export interface AttachOptions {
  /**
   * CSS selector for the element to use as the audit root.
   * Defaults to `"body"`.
   */
  rootSelector?: string;
  /**
   * Which producer builds the tree:
   * - `"dom"` (default) — the injected page-bundle walks the light DOM.
   * - `"native"` — Chromium's own accessibility tree over CDP
   *   (`@real-a11y-dev/browser`'s `nativeTree`). Read-only and whole-document:
   *   snapshot + assertion methods work, but `tabSequenceSnapshot()` throws
   *   (tab order needs interaction data a native tree doesn't carry), and
   *   `rootSelector` scoping is not yet supported.
   */
  tree?: "dom" | "native";
}

export interface AuditSnapshotOptions {
  /** `"a11y"` (default) or `"dom"` tree extraction mode. */
  mode?: "a11y" | "dom";
  /**
   * Regex patterns whose matches are replaced with `[REDACTED]` in accessible
   * names — keeps snapshots deterministic across runs. Mirrors the jsdom
   * `auditSnapshot` option; the adapter marshals each `RegExp` across the
   * `page.evaluate()` boundary (a `RegExp` can't be serialised directly) and
   * reconstructs it inside the page.
   */
  redact?: RegExp[];
  /** Include generic container nodes (`role="generic"`). Default false. */
  includeGeneric?: boolean;
}

export interface SemanticNavigatorPageHandle {
  /** Serialised A11y (or DOM) tree — deterministic, safe to snapshot. */
  auditSnapshot(options?: AuditSnapshotOptions): Promise<string>;
  /** Indented heading outline (h1..h6) in document order. */
  outlineSnapshot(): Promise<string>;
  /** Focusable elements in computed tab order, numbered. */
  tabSequenceSnapshot(): Promise<string>;
  /** Throws if any interactive element has an empty accessible name. */
  assertNoUnlabeledInteractive(): Promise<void>;
  /** Throws if heading levels are skipped or there is not exactly one h1. */
  assertHeadingOrder(): Promise<void>;
  /** Throws if any dialog/alertdialog has no accessible name. */
  assertDialogsLabeled(): Promise<void>;
  /** Throws if the main/banner/contentinfo landmark structure is incorrect. */
  assertLandmarkStructure(): Promise<void>;
}

// ---------------------------------------------------------------------------
// attach()
// ---------------------------------------------------------------------------

/**
 * Inject the Real A11y audit helpers into a Playwright page and return a
 * handle that wraps each helper in a `page.evaluate()` call.
 *
 * @example
 * ```ts
 * import { attach } from "@real-a11y-dev/testing/playwright";
 *
 * test("heading order", async ({ page }) => {
 *   await page.goto("/");
 *   const sn = await attach(page);
 *   await sn.assertHeadingOrder();
 *   expect(await sn.auditSnapshot()).toMatchSnapshot();
 * });
 * ```
 *
 * @example Narrow the audit root to a specific element
 * ```ts
 * const sn = await attach(page, { rootSelector: "main" });
 * await sn.assertNoUnlabeledInteractive();
 * ```
 *
 * ## iframes are not traversed
 *
 * Extraction walks one document. It never descends into an `<iframe>` — the
 * frame is a single `group` node and its contents are absent from every
 * snapshot and assertion. So a page embedding a checkout or payment iframe
 * audits **clean while that content is never checked**. Audit a frame by
 * attaching to it directly:
 *
 * ```ts
 * const outer = await attach(page);                  // host document only
 * const frame = page.frame({ name: "checkout" })!;   // or page.frames()[1]
 * const inner = await attach(frame);                 // the iframe's document
 * await inner.assertNoUnlabeledInteractive();
 * ```
 *
 * ## Navigation
 *
 * The bundle lives on `window`, so a navigation wipes it. When the target is a
 * `Page`, `attach` registers an init script so every subsequent document
 * re-injects it automatically and the handle keeps working across `goto()`.
 * A `Frame` has no `addInitScript`; re-`attach` after it navigates.
 */
export async function attach(
  page: PlaywrightPage,
  options: AttachOptions = {},
): Promise<SemanticNavigatorPageHandle> {
  const rootSelector = options.rootSelector ?? "body";

  // Native producer: no page-bundle injection — read Chromium's own tree over
  // CDP and run the same serialize/audit helpers in Node. Same handle shape.
  if (options.tree === "native") {
    return attachNative(page, rootSelector);
  }

  // Inject the bundle by EVALUATING its source rather than appending a
  // <script> element. `addScriptTag` inserts a real inline <script>, which a
  // page whose CSP `script-src` lacks 'unsafe-inline' blocks outright — and
  // pointing tests at a production-like deployment is exactly when that bites.
  // `page.evaluate(source)` runs through the debugger protocol instead and is
  // not subject to the page's CSP (the same approach axe-core's Playwright
  // adapter takes). The bundle is `var __realA11y__ = (…)(…)`, so evaluating it
  // completes with `undefined` — nothing non-serialisable crosses back.
  // Calling this repeatedly on one page stays harmless: the IIFE just
  // overwrites the same global.
  const bundle = readBundle();

  // Survive navigation. The global lives on `window`, so `page.goto()` (or any
  // hard navigation) wipes it and every later handle call would explode inside
  // the page. An init script re-injects the bundle into each new document, so
  // the handle stays usable across a multi-page test. `Frame` has no
  // `addInitScript` — those callers re-attach after navigating, and the guard
  // in the page functions tells them so.
  //
  // `addInitScript` runs its content inside a function wrapper, so the bundle's
  // top-level `var __realA11y__` would be function-scoped rather than global.
  // Promote it explicitly. (Plain `page.evaluate(source)` runs at global scope,
  // so the `var` already lands on `window` there — no promotion needed.)
  await page.addInitScript?.({
    content: `${bundle}\n;globalThis.__realA11y__ = __realA11y__;`,
  });

  await page.evaluate(bundle);

  // Verify the injection succeeded before returning the handle.
  const ready = await page.evaluate(
    () =>
      typeof (globalThis as Record<string, unknown>).__realA11y__ === "object",
  );
  if (!ready) {
    throw new Error(
      "@real-a11y-dev/testing/playwright: injection failed — " +
        "`__realA11y__` is not an object after injecting the page bundle. " +
        "If the page sends a Content-Security-Policy, create the browser " +
        "context with `{ bypassCSP: true }` and try again.",
    );
  }

  // ── Core helper: call a named export from the page bundle ───────────────

  function evalFn<T>(fnName: string, extraArgs: unknown[] = []): Promise<T> {
    type EvalArg = { selector: string; fn: string; args: unknown[] };
    return page.evaluate(
      (arg) => {
        const { selector, fn, args } = arg as EvalArg;
        const ra = (globalThis as Record<string, unknown>)
          .__realA11y__ as Record<
          string,
          (root: Element, ...a: unknown[]) => unknown
        >;
        // The global is gone when the document changed under us. Say so —
        // dereferencing it gave "Cannot read properties of undefined", which
        // names neither the cause nor the fix.
        if (!ra) {
          throw new Error(
            "@real-a11y-dev/testing/playwright: the page bundle is missing — " +
              "this document navigated since attach(). Call attach() again.",
          );
        }
        // Fail loudly on a selector that matches nothing. Falling back to
        // <body> would silently audit the whole page — a typo'd or since-
        // refactored `rootSelector` would then pass assertions and snapshot
        // the entire document while looking like it checked one region.
        // (The implicit default is the literal selector "body", which always
        // matches, so this only ever fires for an explicit selector.)
        const root = document.querySelector(selector);
        if (!root) {
          throw new Error(
            `@real-a11y-dev/testing/playwright: rootSelector "${selector}" matched no element.`,
          );
        }
        return ra[fn](root, ...args) as T;
      },
      { selector: rootSelector, fn: fnName, args: extraArgs } satisfies EvalArg,
    );
  }

  return {
    auditSnapshot(opts: AuditSnapshotOptions = {}) {
      const { mode, redact, includeGeneric } = opts;
      // `RegExp` doesn't survive `page.evaluate()` serialisation — it arrives
      // as an empty `{}`. Marshal each pattern to a plain `{ source, flags }`
      // pair and rebuild the `RegExp` inside the page.
      const redactParts = redact?.map((re) => ({
        source: re.source,
        flags: re.flags,
      }));

      type AuditArg = {
        selector: string;
        mode?: "a11y" | "dom";
        redact?: { source: string; flags: string }[];
        includeGeneric?: boolean;
      };

      return page.evaluate(
        (arg) => {
          const a = arg as AuditArg;
          const ra = (globalThis as Record<string, unknown>)
            .__realA11y__ as Record<
            string,
            (root: Element, options?: unknown) => unknown
          >;
          // Same contract as evalFn — name the cause instead of letting an
          // undefined global surface as "Cannot read properties of undefined".
          if (!ra) {
            throw new Error(
              "@real-a11y-dev/testing/playwright: the page bundle is missing — " +
                "this document navigated since attach(). Call attach() again.",
            );
          }
          // Same contract as evalFn: a non-matching rootSelector is an error,
          // not a silent widening of the audit to the whole document.
          const root = document.querySelector(a.selector);
          if (!root) {
            throw new Error(
              `@real-a11y-dev/testing/playwright: rootSelector "${a.selector}" matched no element.`,
            );
          }
          const options: Record<string, unknown> = {};
          if (a.mode) options.mode = a.mode;
          if (a.includeGeneric !== undefined)
            options.includeGeneric = a.includeGeneric;
          if (a.redact)
            options.redact = a.redact.map((r) => new RegExp(r.source, r.flags));
          return ra.auditSnapshot(root, options) as string;
        },
        {
          selector: rootSelector,
          mode,
          redact: redactParts,
          includeGeneric,
        } satisfies AuditArg,
      );
    },
    outlineSnapshot() {
      return evalFn<string>("outlineSnapshot");
    },
    tabSequenceSnapshot() {
      return evalFn<string>("tabSequenceSnapshot");
    },
    assertNoUnlabeledInteractive() {
      return evalFn<void>("assertNoUnlabeledInteractive");
    },
    assertHeadingOrder() {
      return evalFn<void>("assertHeadingOrder");
    },
    assertDialogsLabeled() {
      return evalFn<void>("assertDialogsLabeled");
    },
    assertLandmarkStructure() {
      return evalFn<void>("assertLandmarkStructure");
    },
  };
}

/**
 * Native-producer variant of {@link attach}: reads Chromium's own accessibility
 * tree over CDP (`nativeTree`) and runs the same serialize/audit helpers in
 * Node, so `attach(page, { tree: "native" })` returns the same handle shape.
 *
 * The native tree is read-only and whole-document: snapshot + assertion methods
 * work; `tabSequenceSnapshot()` throws (tab order needs interaction data the
 * native tree doesn't carry), and `rootSelector` scoping isn't supported yet.
 * Each call re-reads the tree so the handle reflects the live page, matching the
 * DOM handle's per-call re-extraction.
 */
async function attachNative(
  page: PlaywrightPage,
  rootSelector: string,
): Promise<SemanticNavigatorPageHandle> {
  if (rootSelector !== "body") {
    throw new Error(
      '@real-a11y-dev/testing/playwright: { tree: "native" } does not support ' +
        "rootSelector scoping yet — omit rootSelector to audit the whole document.",
    );
  }

  // `nativeTree` needs a full Playwright `Page` (it opens a CDP session). Derive
  // its exact parameter type from the function so this file needs no direct
  // `playwright` import (keeping the DOM path's structural-typing contract).
  const nativePage = page as unknown as Parameters<typeof nativeTree>[0];
  const getTree = () => nativeTree(nativePage);

  return {
    async auditSnapshot(opts: AuditSnapshotOptions = {}) {
      // `mode` is a DOM-producer concept (a11y vs raw-tag view); the native tree
      // is Chromium's own a11y tree, so it is ignored here.
      return serializeTree(await getTree(), {
        redact: opts.redact,
        includeGeneric: opts.includeGeneric,
      });
    },
    async outlineSnapshot() {
      return serializeOutline(await getTree());
    },
    tabSequenceSnapshot(): Promise<string> {
      // A native tree carries no interaction facet, so tab order can't be
      // computed. Reject rather than return a misleading "(nothing focusable)".
      // Don't read the tree first — the rejection is unconditional, so an
      // unrelated CDP read failure must not mask this read-only explanation.
      return Promise.reject(
        new Error(
          "@real-a11y-dev/testing/playwright: tabSequenceSnapshot() is not " +
            'available with { tree: "native" } — a native tree is read-only and ' +
            'carries no focusability/interaction data. Use { tree: "dom" }.',
        ),
      );
    },
    async assertNoUnlabeledInteractive() {
      assertRules(await getTree(), ["no-unlabeled-interactive"]);
    },
    async assertHeadingOrder() {
      assertRules(await getTree(), ["heading-order"]);
    },
    async assertDialogsLabeled() {
      assertRules(await getTree(), ["dialog-labeled"]);
    },
    async assertLandmarkStructure() {
      assertRules(await getTree(), ["landmark-structure"]);
    },
  };
}
