/**
 * Shared harness for the extension's native-tree e2e suite.
 *
 * Every test here drives the **actual built `dist-dogfood/` extension** in a
 * real Chromium, over the same `chrome.runtime` messages the dogfood panel
 * sends — so what is under test is the real `chrome.debugger` dispatch path,
 * not a stub of it.
 *
 * Three facts about this setup were unknown when the suite was planned and are
 * now measured rather than assumed (see `e2e/README.md` for the full write-up):
 *
 *  - **Playwright's own CDP connection does not collide with the extension's
 *    `chrome.debugger.attach`.** Chromium allows more than one client per
 *    target, so a Playwright-controlled tab attaches fine and Playwright keeps
 *    driving it afterwards. That is what lets a test dispatch through the
 *    extension and then assert on live page state through Playwright.
 *  - **`--headless=new` loads the unpacked MV3 extension with a working
 *    `chrome.debugger`**, so this suite needs no Xvfb. Headed still works; set
 *    `E2E_HEADED=1` to watch it.
 *  - **Fixtures are served over `http://127.0.0.1`, never `file://`.** Not a
 *    preference: `capability.ts` refuses `file://` with `file-url` unless
 *    "Allow access to file URLs" is granted, which is a per-extension user
 *    toggle with no command-line equivalent. A local static server sidesteps
 *    the whole question.
 *
 * The extension launches **once per worker** — an attach/detach cycle per test
 * would dominate the runtime — so tests inside a file run against one browser
 * and clean up their own tab.
 */

import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  chromium,
  test as base,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";

/** The dogfood build — NOT `dist/`. This suite drives `DogfoodPanel`, the
 *  internal diagnostics widget, directly over its own `chrome.runtime`
 *  messages — `__DOGFOOD__` still gates that widget alone (native mode
 *  itself now ships in the store build too, behind the runtime
 *  `settings.nativeModeEnabled` flag), so pointing here at `dist/` would
 *  silently test a build with no `DogfoodPanel` to drive at all. */
// The package is `"type": "module"`, so Playwright loads this file as ESM and
// there is no `__dirname` to lean on.
const HERE = resolve(fileURLToPath(import.meta.url), "..");
const DIST_DOGFOOD = resolve(HERE, "../dist-dogfood");
const FIXTURE_DIR = resolve(HERE, "fixtures");

/** Mirrors the panel's own `NativeAction` union (`native-core.ts`). Declared
 *  rather than imported: the e2e suite talks to the extension over the message
 *  channel, exactly as the panel does, and should not compile against its
 *  internals. A drift here shows up as a refused action, which is the point. */
export type NativeAction =
  "click" | "type" | "focus" | "increment" | "decrement" | "select";

/**
 * One node of a DOM-producer tree, as `TREE_DATA` puts it on the wire.
 *
 * Only the fields the DOM-path tests actually read. Declared rather than
 * imported from `core` for the same reason `NativeNode` is: these tests talk
 * to the extension over its message channel, and compiling against its
 * internals would hide a drift that should show up as a failing assertion.
 */
export interface DomNode {
  id: string;
  dom?: { tagName: string; attributes?: Record<string, string> };
  a11y?: { role: string; name: string };
}

/** A background → panel push, as the e2e recorder stores it. */
export interface PanelMsg {
  type: string;
  tabId?: number;
  payload?: Record<string, unknown>;
}

/** One node as `NATIVE_READ` puts it on the wire. */
export interface NativeNode {
  id: string;
  role: string;
  name: string;
  depth: number;
  states?: Record<string, string | boolean>;
  properties?: Record<string, string>;
  value?: string;
  description?: string;
}

export interface NativeReadResult {
  ok: boolean;
  serialized?: string;
  url?: string;
  nodes?: NativeNode[];
  error?: string;
  reason?: string;
}

export interface NativeActResult {
  success: boolean;
  error?: string;
  reason?: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** Serve `e2e/fixtures/` over loopback. Deliberately minimal — the fixtures are
 *  self-contained single files, so there is nothing to bundle or template. */
async function startFixtureServer(): Promise<{
  origin: string;
  server: Server;
}> {
  const server = createServer((req, res) => {
    // `normalize` collapses `..` before the join, so a fixture URL can never
    // escape the fixture directory even though this only ever serves tests.
    const path = normalize(new URL(req.url ?? "/", "http://x").pathname);
    void readFile(join(FIXTURE_DIR, path))
      .then((body) => {
        res.writeHead(200, {
          "content-type": CONTENT_TYPES[extname(path)] ?? "text/plain",
        });
        res.end(body);
      })
      .catch(() => {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
      });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fixture server did not bind a port");
  }
  return { origin: `http://127.0.0.1:${address.port}`, server };
}

/** The launched dogfood extension, shared by every test in a worker. */
export interface DogfoodBrowser {
  context: BrowserContext;
  /** The extension's own service worker — the only place `chrome.tabs` is
   *  readable, so tab-id resolution goes through here. */
  serviceWorker: Worker;
  /** A page on the extension's own origin. Native messages must originate from
   *  an extension-origin document: `isTrustedSender` (`routing.js`) gates
   *  `chrome.runtime.onMessage` to same-extension senders, and the dev flag
   *  lives in `chrome.storage.local`, which a content page cannot reach. */
  panel: Page;
  extensionId: string;
  fixtureOrigin: string;
}

async function launchDogfoodExtension(): Promise<
  DogfoodBrowser & { dispose: () => Promise<void> }
> {
  const { origin, server } = await startFixtureServer();
  const userDataDir = await mkdtemp(join(tmpdir(), "real-a11y-ext-e2e-"));

  const args = [
    `--disable-extensions-except=${DIST_DOGFOOD}`,
    `--load-extension=${DIST_DOGFOOD}`,
  ];
  // `--headless=new` is passed as an ARG rather than through Playwright's
  // `headless: true`, which selects the old headless shell — that one loads no
  // extensions at all. Verified: the new mode loads the unpacked MV3 build with
  // a working `chrome.debugger`.
  if (!process.env.E2E_HEADED) args.push("--headless=new");

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args,
    // The repo's own Chrome-override convention (`resolveChromeExecutable` in
    // `@real-a11y-dev/browser`). Unset means Playwright's bundled Chromium.
    ...(process.env.REAL_A11Y_CHROME_PATH
      ? { executablePath: process.env.REAL_A11Y_CHROME_PATH }
      : {}),
  });

  const [existing] = context.serviceWorkers();
  const serviceWorker =
    existing ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(serviceWorker.url()).host;

  const panel = await context.newPage();
  await panel.goto(
    `chrome-extension://${extensionId}/src/sidepanel/index.html`,
  );
  // Native mode is off by default, gated by the user-facing runtime setting
  // (`settings.nativeModeEnabled` in `chrome.storage.local` —
  // `packages/extension/src/native/index.ts`'s `FLAG_KEY`). Flipping it here
  // is what the "Enable native mode…" toggle does; `attach()` enforces it
  // inside its storage transaction, so every later `NATIVE_READ`/`NATIVE_ACT`
  // in this worker sees it.
  await panel.evaluate(() =>
    chrome.storage.local.set({ "settings.nativeModeEnabled": true }),
  );

  return {
    context,
    serviceWorker,
    panel,
    extensionId,
    fixtureOrigin: origin,
    dispose: async () => {
      await context.close();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(userDataDir, { recursive: true, force: true });
    },
  };
}

/** A fixture page, plus the tab id the native path addresses it by. */
export interface FixtureTab {
  page: Page;
  tabId: number;
}

/** Per-test API over one launched extension. */
export class NativeHarness {
  private readonly opened: Page[] = [];

  constructor(private readonly browser: DogfoodBrowser) {}

  /**
   * The extension-origin page every native message is sent from.
   *
   * Exposed because a handful of tests drive the dogfood panel's own UI rather
   * than the message channel underneath it — the only level at which a
   * panel-wiring bug (a role with the right predicate but no button rendered,
   * or a button wired to the wrong action) is visible at all.
   */
  get panel(): Page {
    return this.browser.panel;
  }

  /**
   * Open a fixture and resolve its Chrome tab id.
   *
   * A unique nonce goes on the query string because tab lookup matches on URL
   * and a worker may have several fixture tabs alive at once — matching on the
   * bare fixture name would hand back whichever tab happened to be first.
   */
  async open(fixture: string): Promise<FixtureTab> {
    const url = `${this.browser.fixtureOrigin}/${fixture}?t=${Date.now()}-${this.opened.length}`;
    const page = await this.browser.context.newPage();
    this.opened.push(page);
    await page.goto(url);
    // The AX tree is read from Chromium's own snapshot; reading before the
    // fixture's inline script has wired its widgets gives a real but premature
    // tree, which fails as a flake rather than as a finding.
    await page.waitForLoadState("load");
    const tabId = await this.browser.serviceWorker.evaluate(async (want) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((t) => t.url === want)?.id ?? null;
    }, url);
    if (tabId === null) throw new Error(`no tab found for fixture ${fixture}`);
    return { page, tabId };
  }

  /** Read the native tree, as the panel's "Load native tree" button does. */
  async read(tabId: number): Promise<NativeReadResult> {
    return await this.send<NativeReadResult>({ type: "NATIVE_READ", tabId });
  }

  /** Read, and fail loudly rather than returning an unusable result — every
   *  test wants the nodes, and a refusal is a harness problem, not a finding. */
  async readNodes(tabId: number): Promise<NativeNode[]> {
    const result = await this.read(tabId);
    if (!result.ok || !result.nodes) {
      throw new Error(
        `native read failed: ${result.error ?? "?"} (${result.reason ?? "no reason"})`,
      );
    }
    return result.nodes;
  }

  /** Dispatch an action against a native node id. */
  async act(
    tabId: number,
    nodeId: string,
    action: NativeAction,
    value?: string,
  ): Promise<NativeActResult> {
    return await this.send<NativeActResult>({
      type: "NATIVE_ACT",
      tabId,
      nodeId,
      action,
      ...(value === undefined ? {} : { value }),
    });
  }

  /** What the panel would ask before offering controls at all. */
  async capability(
    tabId: number,
  ): Promise<{ native: boolean; reason?: string; domFallback: boolean }> {
    return await this.send({ type: "NATIVE_CAPABILITY", tabId });
  }

  // ---- DOM producer ------------------------------------------------------
  //
  // Everything above drives the dev-only NATIVE path. The methods below drive
  // the one the STORE build actually ships: an in-page content script that
  // walks the DOM and dispatches through it. What they buy over a jsdom suite
  // is the part jsdom can only approximate — real capture-phase event
  // handling, in real Chromium, across real frames.
  //
  // They address the frames FROM THE SERVICE WORKER, which is where the
  // background addresses them from, rather than by sending panel messages.
  // That is forced, not stylistic: this harness loads the panel as an ordinary
  // tab so Playwright can drive it, and the background's router splits on
  // `sender.tab?.id` (a real side panel has no tab). A panel-as-tab's messages
  // are therefore read as if a content script sent them, and every DOM-path
  // command would be silently misrouted. So these mirror what the background
  // does with each command — fan SET_PICK_MODE out to every frame, address
  // DISPATCH_ACTION to the frame named in the node id — and leave the
  // background's own routing to `background.test.ts` and `routing.test.ts`,
  // which cover it directly.

  /**
   * Ask every frame in the tab to extract, and return the merged tree the
   * panel would render — node ids frame-prefixed, exactly as a tree row
   * carries them.
   *
   * `REQUEST_TREE` is answered per frame; the MERGED tree arrives separately,
   * as the background's `TREE_DATA` push to the panel once its debounce
   * settles. So this polls the recorder rather than reading a return value.
   */
  async domTree(tabId: number): Promise<{ nodes: [string, DomNode][] }> {
    await this.watchPanelMessages();
    const before = await this.panelMessageCount();
    await this.toFrames(tabId, {
      type: "REQUEST_TREE",
      payload: { viewMode: "a11y" },
    });
    const deadline = Date.now() + 10_000;
    for (;;) {
      const tree = await this.browser.panel.evaluate(
        ([tab, from]) => {
          const seen = (window as unknown as { __e2eMessages: PanelMsg[] })
            .__e2eMessages;
          for (let i = seen.length - 1; i >= from; i -= 1) {
            const m = seen[i];
            if (m?.type === "TREE_DATA" && m.tabId === tab) return m.payload;
          }
          return null;
        },
        [tabId, before] as const,
      );
      if (tree) return tree as { nodes: [string, DomNode][] };
      if (Date.now() > deadline) {
        throw new Error(`no TREE_DATA for tab ${tabId} within 10s`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** Arm or disarm the element picker in EVERY frame, as the background's
   *  `broadcastToAllFrames` does for SET_PICK_MODE. Fanning out is the point:
   *  pick mode is per frame, and the panel's toggle is per tab. */
  async setPickMode(tabId: number, enabled: boolean): Promise<void> {
    await this.toFrames(tabId, {
      type: "SET_PICK_MODE",
      payload: { enabled },
    });
  }

  /**
   * Dispatch a DOM-producer action, as a click on a tree row's ⏎ does.
   *
   * `nodeId` is the merged, frame-prefixed id. Splitting it and addressing
   * that one frame with the frame-local id is what the background does for
   * DISPATCH_ACTION; sending the prefixed id to frame 0 would just miss.
   */
  async domAct(
    tabId: number,
    nodeId: string,
    action: string,
  ): Promise<{ success?: boolean; error?: string }> {
    const match = /^f(\d+)-(.+)$/.exec(nodeId);
    const frameId = match ? Number(match[1]) : 0;
    const localId = match ? match[2] : nodeId;
    return await this.toFrame(tabId, frameId, {
      type: "DISPATCH_ACTION",
      payload: { nodeId: localId, action },
    });
  }

  /** Send to one frame's content script, from the extension's own service
   *  worker — which is what satisfies the content script's `isTrustedSender`. */
  private async toFrame<T>(
    tabId: number,
    frameId: number,
    message: object,
  ): Promise<T> {
    return (await this.browser.serviceWorker.evaluate(
      ([tab, frame, m]) =>
        new Promise((resolve) => {
          chrome.tabs.sendMessage(
            tab as number,
            m as object,
            { frameId: frame as number },
            (response) => {
              resolve(
                chrome.runtime.lastError
                  ? { error: chrome.runtime.lastError.message }
                  : response,
              );
            },
          );
        }),
      [tabId, frameId, message] as const,
    )) as T;
  }

  /** Send to every frame in the tab. Omitting `frameId` is how
   *  `chrome.tabs.sendMessage` broadcasts, and how the background does it. */
  private async toFrames(tabId: number, message: object): Promise<void> {
    await this.browser.serviceWorker.evaluate(
      ([tab, m]) => chrome.tabs.sendMessage(tab as number, m as object),
      [tabId, message] as const,
    );
  }

  /**
   * Record every background → panel push, so a test can assert on what did
   * NOT arrive (a `NODE_PICKED` nobody asked for) as well as what did.
   *
   * Installed once per panel page and idempotent: the panel outlives each
   * test, and a second listener would double every message.
   */
  async watchPanelMessages(): Promise<void> {
    await this.browser.panel.evaluate(() => {
      const w = window as unknown as { __e2eMessages?: PanelMsg[] };
      if (w.__e2eMessages) return;
      w.__e2eMessages = [];
      chrome.runtime.onMessage.addListener((m: PanelMsg) => {
        w.__e2eMessages?.push(m);
        // Returning a value here would claim the response channel from the
        // panel's own listener; this one only observes.
      });
    });
  }

  /** How many pushes have been recorded — a mark to filter later ones by. */
  async panelMessageCount(): Promise<number> {
    return await this.browser.panel.evaluate(
      () =>
        (window as unknown as { __e2eMessages?: PanelMsg[] }).__e2eMessages
          ?.length ?? 0,
    );
  }

  /** Recorded pushes of one type, from `from` onwards. */
  async panelMessages(type: string, from = 0): Promise<PanelMsg[]> {
    return await this.browser.panel.evaluate(
      ([want, start]) =>
        (
          (window as unknown as { __e2eMessages?: PanelMsg[] }).__e2eMessages ??
          []
        )
          .slice(start)
          .filter((m) => m?.type === want),
      [type, from] as const,
    );
  }

  private async send<T>(message: object): Promise<T> {
    return (await this.browser.panel.evaluate(
      (m) => chrome.runtime.sendMessage(m),
      message,
    )) as T;
  }

  /** Close the tabs this test opened. A worker's browser outlives the test, so
   *  leaked tabs would accumulate and slow every later tab lookup. */
  async closeAll(): Promise<void> {
    for (const page of this.opened) await page.close();
    this.opened.length = 0;
  }
}

/**
 * First node matching role (+ optional accessible-name substring), mirroring
 * `findNative` in `native-core.ts`. Throws rather than returning undefined: a
 * missing node means the tree does not describe the widget the test is about,
 * which is a failure worth naming, not an assertion on `undefined`.
 */
export function node(
  nodes: NativeNode[],
  role: string,
  nameIncludes?: string,
): NativeNode {
  const found = nodes.find(
    (n) =>
      n.role === role &&
      (nameIncludes === undefined ||
        n.name.toLowerCase().includes(nameIncludes.toLowerCase())),
  );
  if (!found) {
    const roles = [...new Set(nodes.map((n) => n.role))].sort().join(", ");
    throw new Error(
      `no ${role} node${nameIncludes ? ` named ~"${nameIncludes}"` : ""}; ` +
        `tree has roles: ${roles}`,
    );
  }
  return found;
}

/** Every node matching a role, in document order. */
export function nodes(all: NativeNode[], role: string): NativeNode[] {
  return all.filter((n) => n.role === role);
}

export const test = base.extend<
  { nav: NativeHarness },
  { dogfood: DogfoodBrowser }
>({
  // Playwright reads a fixture's dependencies off its destructuring pattern, so
  // a fixture with none has to destructure nothing rather than take an unused
  // parameter.
  dogfood: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const launched = await launchDogfoodExtension();
      await use(launched);
      await launched.dispose();
    },
    { scope: "worker" },
  ],
  nav: async ({ dogfood }, use) => {
    const harness = new NativeHarness(dogfood);
    await use(harness);
    await harness.closeAll();
  },
});

export { expect } from "@playwright/test";
