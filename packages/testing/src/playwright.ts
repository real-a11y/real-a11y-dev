/**
 * Playwright adapter for @real-a11y-dev/testing.
 *
 * Separate entrypoint so bundlers don't pull `playwright` into consumers
 * that only use the jsdom/Vitest helpers.
 *
 * Architecture:
 *   1. `attach()` reads the pre-built IIFE page-bundle from dist/.
 *   2. Injects it into the Playwright page via `page.addScriptTag()`.
 *      This sets `window.__realA11y__` inside the browser.
 *   3. Returns a `SemanticNavigatorPageHandle` whose methods call
 *      `page.evaluate()`, routing each call through the injected bundle.
 *
 * Error propagation: when an assertion function throws inside the page,
 * Playwright re-throws it in Node with the original message preserved.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Bundle path — resolved relative to this compiled file (dist/playwright.js).
// tsup appends `.global` to the filename when globalName is set.
// ---------------------------------------------------------------------------

function getPageBundlePath(): string {
  // Works from both the TypeScript source location (src/) and the compiled
  // output location (dist/). In both cases, `../dist/` resolves to the
  // package-level dist/ directory where the IIFE bundle lives.
  //
  // From src/playwright.ts:  src/ → ../dist/ = dist/ ✓
  // From dist/playwright.js: dist/ → ../dist/ = dist/ ✓  (redundant but correct)
  return fileURLToPath(
    new URL("../dist/page-bundle.iife.global.js", import.meta.url),
  );
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

/** Minimal structural type for a Playwright `Page`. Accepts the real type. */
export type PlaywrightPage = {
  evaluate<R>(pageFunction: (arg: unknown) => R, arg?: unknown): Promise<R>;
  addScriptTag(options: { content?: string; url?: string }): Promise<unknown>;
};

export interface AttachOptions {
  /**
   * CSS selector for the element to use as the audit root.
   * Defaults to `"body"`.
   */
  rootSelector?: string;
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
 */
export async function attach(
  page: PlaywrightPage,
  options: AttachOptions = {},
): Promise<SemanticNavigatorPageHandle> {
  const rootSelector = options.rootSelector ?? "body";

  // Inject the IIFE bundle. Calling this multiple times on the same page is
  // harmless — the IIFE is idempotent and overwrites the same global.
  await page.addScriptTag({ content: readBundle() });

  // Verify the injection succeeded before returning the handle.
  const ready = await page.evaluate(
    () =>
      typeof (globalThis as Record<string, unknown>).__realA11y__ === "object",
  );
  if (!ready) {
    throw new Error(
      "@real-a11y-dev/testing/playwright: injection failed — " +
        "__realA11y__ is not an object after addScriptTag.",
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
        const root = document.querySelector(selector) ?? document.body;
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
          const root = document.querySelector(a.selector) ?? document.body;
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
