/**
 * Browser session for the MCP server.
 *
 * Mirrors the architecture of `@real-a11y-dev/testing/playwright`: drive a real
 * browser with Playwright, inject the pre-built IIFE page-bundle (which sets
 * `window.__realA11y__`), and route each a11y query through `page.evaluate()`.
 *
 * A real browser is required — the extraction engine depends on
 * `getComputedStyle`/layout to decide what is exposed to assistive tech, which
 * a serverside jsdom cannot faithfully reproduce.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { Finding } from "@real-a11y-dev/testing";
import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
} from "playwright";

/** Resolve the testing package's injected page-bundle from node_modules. */
function bundlePath(): string {
  const require = createRequire(import.meta.url);
  // Resolves to @real-a11y-dev/testing/dist/index.* — the bundle sits beside it.
  const testingEntry = require.resolve("@real-a11y-dev/testing");
  return join(dirname(testingEntry), "page-bundle.iife.global.js");
}

let cachedBundle: string | undefined;
function readBundle(): string {
  if (!cachedBundle) {
    try {
      cachedBundle = readFileSync(bundlePath(), "utf8");
    } catch {
      // Don't leak the absolute local path into tool output.
      throw new Error(
        "Real A11y extraction bundle is missing — reinstall dependencies (is @real-a11y-dev/testing installed?).",
      );
    }
  }
  return cachedBundle;
}

/**
 * Reject non-web URLs before navigating. `file://` is a local-file exfiltration
 * primitive for an LLM-driven server (open `file:///…/.env`, then read the DOM
 * back), so it's blocked unless `REAL_A11Y_MCP_ALLOW_FILE=1`. `data:` is allowed
 * (it's caller-supplied inline content, not a filesystem read).
 */
export function assertOpenableUrl(url: string): void {
  let scheme: string;
  try {
    scheme = new URL(url).protocol.replace(/:$/, "").toLowerCase();
  } catch {
    throw new Error(`Not a valid absolute URL: ${JSON.stringify(url)}`);
  }
  if (scheme === "http" || scheme === "https" || scheme === "data") return;
  if (scheme === "file" && process.env.REAL_A11Y_MCP_ALLOW_FILE === "1") return;
  throw new Error(
    `Refusing to open a ${scheme}: URL — only http(s) (and data:) are allowed` +
      (scheme === "file"
        ? " (set REAL_A11Y_MCP_ALLOW_FILE=1 to permit file://)."
        : "."),
  );
}

/** A subset of a Chromium CDP `Accessibility.AXNode`. */
interface AXNode {
  nodeId: string;
  parentId?: string;
  childIds?: string[];
  role?: { value?: string };
  name?: { value?: string };
  ignored?: boolean;
}

// Native roles that are structural noise vs. our custom tree: text runs and
// generic wrappers the custom serializer collapses into names / drops.
const NATIVE_DROP = new Set([
  "StaticText",
  "InlineTextBox",
  "LineBreak",
  "LabelText",
  "generic",
  "none",
  "presentation",
  "RootWebArea",
]);
// Blink AX role → the ARIA role our custom tree uses, where they differ.
const NATIVE_ROLE_MAP: Record<string, string> = { image: "img" };

/**
 * Reconstruct Chromium's native accessibility tree from a flat `getFullAXTree`
 * node list and serialize it in the same `role "name"` shape our custom tree
 * uses — so the two are comparable. Returns the indented tree plus a flat list
 * of role+name pairs (for order/indent-insensitive diffing).
 */
function serializeNativeAX(nodes: AXNode[]): { tree: string; pairs: string[] } {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const roots = nodes.filter((n) => !n.parentId);
  const treeLines: string[] = [];
  const pairs: string[] = [];

  const walk = (node: AXNode, depth: number): void => {
    const role = node.role?.value ?? "";
    const drop = node.ignored || NATIVE_DROP.has(role);
    let childDepth = depth;
    if (!drop && role) {
      const mapped = NATIVE_ROLE_MAP[role] ?? role;
      const name = (node.name?.value ?? "").replace(/\s+/g, " ").trim();
      const pair = name ? `${mapped} "${name}"` : mapped;
      treeLines.push(`${"  ".repeat(depth)}${pair}`);
      pairs.push(pair);
      childDepth = depth + 1;
    }
    for (const cid of node.childIds ?? []) {
      const child = byId.get(cid);
      if (child) walk(child, childDepth);
    }
  };

  for (const root of roots) walk(root, 0);
  return { tree: treeLines.join("\n"), pairs };
}

let cachedExpr: string | undefined;
/**
 * The IIFE bundle wrapped as a single self-executing expression that hoists its
 * global (`var __realA11y__ = …`) onto `globalThis`.
 *
 * We inject this via `page.evaluate`, which runs through the CDP runtime and is
 * **not** subject to the page's CSP or Trusted Types. `addScriptTag` (sets
 * `<script>.text`) is blocked by `require-trusted-types-for 'script'`, and
 * `addInitScript` is CSP-gated too — both fail on YouTube, Google, GitHub, and
 * many enterprise apps. Evaluating the source directly is the robust path.
 */
function bundleExpression(): string {
  if (!cachedExpr) {
    cachedExpr = `(function(){\n${readBundle()}\n;globalThis.__realA11y__=__realA11y__;})()`;
  }
  return cachedExpr;
}

export interface BrowserSessionOptions {
  /** Launch headless (default true). Ignored when `cdpEndpoint` is set. */
  headless?: boolean;
  /**
   * Attach to a user's already-running Chrome over the DevTools protocol
   * instead of launching a fresh browser (e.g. "http://localhost:9222").
   */
  cdpEndpoint?: string;
}

/** Navigation / settle options for {@link A11ySession.open}. */
export interface OpenOptions {
  /**
   * Playwright navigation wait state. `"networkidle"` waits until the network
   * has been quiet for 500ms — the most reliable "the SPA finished rendering"
   * signal, at the cost of latency. Default `"load"`.
   */
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  /**
   * Extra fixed settle time (ms) after the wait state, to let late-firing JS
   * (async content, consent dialogs) reach a stable state before extraction.
   * Default 0.
   */
  settleMs?: number;
  /**
   * Emulate a device by Playwright device name — e.g. `"iPhone 13"`,
   * `"Pixel 7"`, `"iPad Pro 11"`. Sets viewport, user-agent, touch, and device
   * scale so the extracted tree reflects the **mobile/tablet** layout, not
   * desktop. Changing device between calls rebuilds the browser context.
   * Not supported over a `cdpEndpoint` (reuses the running browser's context).
   */
  device?: string;
  /**
   * Explicit viewport override, e.g. `{ width: 375, height: 812 }`. Layered on
   * top of `device` when both are given.
   */
  viewport?: { width: number; height: number };
  /** Navigation timeout in ms. Default is Playwright's 30s. */
  timeoutMs?: number;
}

/** Options for a single-extraction {@link A11ySession.snapshot}. */
export interface SnapshotOptions {
  /** Rules to run for `findings`. Omit to run all. */
  rules?: string[];
  /** Include generic container nodes in `tree`. Default false. */
  includeGeneric?: boolean;
}

/**
 * All four views derived from **one** extraction — so they can never disagree.
 * The fix for cross-call drift: `findings`, `tree`, `outline`, and `tabOrder`
 * are computed from a single a11y tree snapshot, not four separate extractions.
 */
export interface PageSnapshot {
  findings: Finding[];
  tree: string;
  outline: string;
  tabOrder: string;
}

/**
 * The session surface the MCP server depends on. Implemented by
 * {@link BrowserSession} in production and faked in unit tests, so the server
 * wiring can be exercised without launching a browser.
 */
export interface A11ySession {
  open(
    url: string,
    options?: OpenOptions,
  ): Promise<{ title: string; url: string }>;
  call<T>(fn: string, rootSelector: string, args?: unknown[]): Promise<T>;
  snapshot(
    rootSelector: string,
    options?: SnapshotOptions,
  ): Promise<PageSnapshot>;
  /** The browser's own (native) accessibility tree via CDP — Chromium only. */
  nativeAX(): Promise<{ tree: string; pairs: string[] }>;
  close(): Promise<void>;
}

export class BrowserSession implements A11ySession {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  /** Signature of the current context's emulation, to detect device changes. */
  private emulationKey = "";
  /** Over CDP: whether we created `page` (so `close()` only closes our tab). */
  private ownsPage = false;
  /** Serializes every operation so concurrent tool calls can't race the page. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: BrowserSessionOptions = {}) {}

  /**
   * Run `fn` after any in-flight operation. MCP clients dispatch tool calls
   * concurrently, but all tools share one mutable `page`, so we single-flight.
   */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn, fn);
    // Keep the chain alive even if this op rejects.
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Navigate to `url`, settle, then confirm the bundle initialized. */
  async open(
    url: string,
    options: OpenOptions = {},
  ): Promise<{ title: string; url: string }> {
    return this.run(async () => {
      assertOpenableUrl(url);
      const {
        waitUntil = "load",
        settleMs = 0,
        device,
        viewport,
        timeoutMs,
      } = options;
      const page = await this.ensurePage({ device, viewport });
      try {
        await page.goto(url, {
          waitUntil,
          ...(timeoutMs != null ? { timeout: timeoutMs } : {}),
        });
      } catch (err) {
        // Only tolerate a timeout for `networkidle` — chatty sites (analytics,
        // sockets) never fully idle. For other wait states a timeout means the
        // navigation didn't happen, so surface it.
        const isTimeout = err instanceof Error && err.name === "TimeoutError";
        if (!(isTimeout && waitUntil === "networkidle")) throw err;
      }
      if (settleMs > 0) await page.waitForTimeout(settleMs);
      // A tolerated timeout can leave us on about:blank (nav never committed) —
      // don't silently audit an empty tab as if it were the requested URL.
      if (page.url() === "about:blank") {
        throw new Error(
          `Navigation to ${url} did not complete (still on about:blank). Try waitUntil:"load" or a larger timeoutMs.`,
        );
      }
      await this.injectBundle(page);
      await this.verifyReady(page);
      return { title: await page.title(), url: page.url() };
    });
  }

  /**
   * Run a named export from the injected bundle against a root selector.
   * Re-injects first if a navigation wiped the global.
   */
  async call<T>(
    fn: string,
    rootSelector: string,
    args: unknown[] = [],
  ): Promise<T> {
    return this.run(async () => {
      const page = this.requirePage();
      await this.ensureInjected(page);
      return page.evaluate(
        ({ fn, selector, args }) => {
          const ra = (globalThis as Record<string, unknown>).__realA11y__ as
            | Record<string, (root: Element, ...rest: unknown[]) => unknown>
            | undefined;
          if (!ra) throw new Error("__realA11y__ is not present on the page.");
          if (typeof ra[fn] !== "function") {
            throw new Error(
              `Real A11y bundle has no "${fn}" — the installed @real-a11y-dev/testing is too old for this MCP server; upgrade it.`,
            );
          }
          let root: Element | null;
          try {
            root = document.querySelector(selector);
          } catch {
            throw new Error(`Invalid rootSelector: "${selector}".`);
          }
          if (!root) {
            if (selector === "body" && document.body) root = document.body;
            else {
              throw new Error(
                `rootSelector "${selector}" matched no element on the page.`,
              );
            }
          }
          return ra[fn](root, ...args) as unknown;
        },
        { fn, selector: rootSelector, args },
      ) as Promise<T>;
    });
  }

  /**
   * Extract the a11y tree **once** and derive all four views from it inside a
   * single `page.evaluate`, so findings / tree / outline / tab order always
   * describe the same instant — no cross-call drift on a moving page.
   */
  async snapshot(
    rootSelector: string,
    options: SnapshotOptions = {},
  ): Promise<PageSnapshot> {
    return this.run(async () => {
      const page = this.requirePage();
      await this.ensureInjected(page);
      return page.evaluate(
        ({ selector, rules, includeGeneric }) => {
          const ra = (globalThis as Record<string, unknown>).__realA11y__ as
            | Record<string, (...a: unknown[]) => unknown>
            | undefined;
          if (!ra || typeof ra.extractA11yTree !== "function") {
            throw new Error(
              "Real A11y bundle missing/too old — upgrade @real-a11y-dev/testing.",
            );
          }
          let el: Element | null;
          try {
            el = document.querySelector(selector);
          } catch {
            throw new Error(`Invalid rootSelector: "${selector}".`);
          }
          if (!el) {
            if (selector === "body" && document.body) el = document.body;
            else {
              throw new Error(
                `rootSelector "${selector}" matched no element on the page.`,
              );
            }
          }
          const tree = ra.extractA11yTree(el); // ← the single extraction
          return {
            findings: ra.collectFindings(
              tree,
              rules && rules.length ? rules : undefined,
            ),
            tree: ra.auditSnapshot(tree, { includeGeneric }),
            outline: ra.outlineSnapshot(tree),
            tabOrder: ra.tabSequenceSnapshot(tree),
          };
        },
        {
          selector: rootSelector,
          rules: options.rules ?? null,
          includeGeneric: options.includeGeneric ?? false,
        },
      ) as Promise<PageSnapshot>;
    });
  }

  /**
   * Chromium's own accessibility tree, straight from Blink via the CDP
   * `Accessibility` domain — the authoritative computation, not our
   * reimplementation. Used to cross-check custom-engine fidelity.
   */
  async nativeAX(): Promise<{ tree: string; pairs: string[] }> {
    return this.run(async () => {
      const page = this.requirePage();
      const client = await page.context().newCDPSession(page);
      try {
        await client.send("Accessibility.enable");
        const { nodes } = (await client.send(
          "Accessibility.getFullAXTree",
        )) as { nodes: AXNode[] };
        return serializeNativeAX(nodes);
      } finally {
        await client.detach().catch(() => {});
      }
    });
  }

  async close(): Promise<void> {
    return this.run(async () => {
      if (this.opts.cdpEndpoint) {
        // Attached to the user's own browser: close only the tab we created and
        // disconnect — never close their Chrome or their other tabs.
        if (this.ownsPage) await this.page?.close().catch(() => {});
        await this.browser?.close().catch(() => {});
      } else {
        await this.context?.close().catch(() => {});
        await this.browser?.close().catch(() => {});
      }
      this.browser = undefined;
      this.context = undefined;
      this.page = undefined;
      this.ownsPage = false;
      this.emulationKey = "";
    });
  }

  hasPage(): boolean {
    return this.page !== undefined;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private requirePage(): Page {
    if (!this.page) {
      throw new Error("No page is open. Call the open_page tool first.");
    }
    return this.page;
  }

  private async ensurePage(
    emu: { device?: string; viewport?: { width: number; height: number } } = {},
  ): Promise<Page> {
    // playwright is a peer dep; import lazily so importing the server API
    // (types, buildServer) never requires playwright to be installed.
    const { chromium, devices } = await import("playwright");

    // CDP: attach to the running browser's context. Device emulation can't be
    // applied to an already-open browser, so reject it explicitly.
    if (this.opts.cdpEndpoint) {
      if (emu.device || emu.viewport) {
        throw new Error(
          "Device / viewport emulation is not supported over a CDP connection — it reuses the running browser's own context.",
        );
      }
      if (this.page && !this.page.isClosed()) return this.page;
      if (!this.browser || !this.browser.isConnected()) {
        this.browser = await chromium.connectOverCDP(this.opts.cdpEndpoint);
      }
      this.context =
        this.browser.contexts()[0] ?? (await this.browser.newContext());
      // Create our OWN tab rather than hijacking the user's oldest one.
      this.page = await this.context.newPage();
      this.ownsPage = true;
      return this.page;
    }

    // Reuse the current page only when it's live and the emulation is unchanged.
    const key = JSON.stringify({
      device: emu.device ?? null,
      viewport: emu.viewport ?? null,
    });
    if (this.page && !this.page.isClosed() && key === this.emulationKey) {
      return this.page;
    }

    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({
        headless: this.opts.headless ?? true,
      });
    }

    // Resolve the device descriptor BEFORE tearing down the old context, so a
    // mistyped device name doesn't destroy the current session.
    let ctxOpts: BrowserContextOptions = {};
    if (emu.device) {
      const descriptor = devices[emu.device];
      if (!descriptor) {
        throw new Error(
          `Unknown device "${emu.device}". Use a Playwright device name such as "iPhone 13", "Pixel 7", or "iPad Pro 11".`,
        );
      }
      ctxOpts = descriptor;
    }
    if (emu.viewport) ctxOpts = { ...ctxOpts, viewport: emu.viewport };

    // Emulation changed (or first open) → rebuild the context with it.
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = undefined;
      this.page = undefined;
    }
    this.context = await this.browser.newContext(ctxOpts);
    this.page = await this.context.newPage();
    this.emulationKey = key;
    return this.page;
  }

  /** Evaluate the bundle in the page (CSP / Trusted-Types-safe via CDP). */
  private async injectBundle(page: Page): Promise<void> {
    await page.evaluate(bundleExpression());
  }

  /** (Re)inject the bundle if a navigation wiped the global. */
  private async ensureInjected(page: Page): Promise<void> {
    if (!(await this.isReady(page))) await this.injectBundle(page);
  }

  /** Confirm the bundle initialized; throw a clear error if not. */
  private async verifyReady(page: Page): Promise<void> {
    if (!(await this.isReady(page))) {
      throw new Error(
        "Real A11y extraction bundle did not initialize on this page — a strict Content-Security-Policy may be blocking script evaluation here.",
      );
    }
  }

  private isReady(page: Page): Promise<boolean> {
    return page.evaluate(
      () =>
        typeof (globalThis as Record<string, unknown>).__realA11y__ ===
        "object",
    );
  }
}
