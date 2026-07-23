/**
 * SPIKE — Desktop Semantic Navigator (idea validation)
 *
 * Product thesis: the tree *is* the interface. The auditor never sees the
 * visual page — only the accessibility tree — and completes tasks through it.
 * That needs CDP (native tree + actions). The Chrome extension can't do this
 * without chrome.debugger; a desktop/headless shell can.
 *
 * This spike is NOT Electron yet. It proves the interaction model:
 *   - Chromium runs headless (page invisible to the auditor)
 *   - A tree-only panel UI is the sole interface
 *   - Native AX via CDP + click/type via Runtime.callFunctionOn
 *   - Re-extract after action (status / checkbox state changes)
 *
 *   pnpm --filter @real-a11y-dev/browser run test:spike:desktop
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type CDPSession, type Page } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(join(here, "fixture.html"), "utf8");
const panelHtml = readFileSync(join(here, "panel.html"), "utf8");

export interface AxNode {
  nodeId: string;
  parentId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
}

export interface PanelNode {
  id: string;
  role: string;
  name: string;
  depth: number;
  backendDOMNodeId: number | null;
  childIds: string[];
}

const DROP = new Set([
  "StaticText",
  "InlineTextBox",
  "LineBreak",
  "LabelText",
  "ListMarker",
  "generic",
  "none",
  "presentation",
  "RootWebArea",
]);

const ROLE_MAP: Record<string, string> = {
  Video: "video",
  Audio: "audio",
  image: "img",
};

function normalize(axNodes: AxNode[]): PanelNode[] {
  const byId = new Map(axNodes.map((n) => [n.nodeId, n]));
  const keep = new Set<string>();
  for (const n of axNodes) {
    const role = n.role?.value ?? "";
    if (n.ignored || !role || DROP.has(role)) continue;
    keep.add(n.nodeId);
  }

  const keptParent = (id: string): string | null => {
    let cur = byId.get(id)?.parentId;
    while (cur) {
      if (keep.has(cur)) return cur;
      cur = byId.get(cur)?.parentId;
    }
    return null;
  };

  const childrenOf = new Map<string | null, string[]>();
  for (const id of keep) {
    const p = keptParent(id);
    const list = childrenOf.get(p) ?? [];
    list.push(id);
    childrenOf.set(p, list);
  }

  const out: PanelNode[] = [];
  const walk = (axId: string, depth: number) => {
    const ax = byId.get(axId)!;
    const raw = ax.role?.value ?? "generic";
    let name = (ax.name?.value ?? "").replace(/\s+/g, " ").trim();
    if (!name) {
      for (const cid of ax.childIds ?? []) {
        const c = byId.get(cid);
        if (c?.role?.value === "StaticText") {
          const n = (c.name?.value ?? "").trim();
          if (n) {
            name = n;
            break;
          }
        }
      }
    }
    const childAx = childrenOf.get(axId) ?? [];
    const id =
      typeof ax.backendDOMNodeId === "number"
        ? `ax-dom-${ax.backendDOMNodeId}`
        : `ax-${ax.nodeId}`;
    out.push({
      id,
      role: ROLE_MAP[raw] ?? raw,
      name,
      depth,
      backendDOMNodeId:
        typeof ax.backendDOMNodeId === "number" ? ax.backendDOMNodeId : null,
      childIds: childAx.map((c) => {
        const child = byId.get(c)!;
        return typeof child.backendDOMNodeId === "number"
          ? `ax-dom-${child.backendDOMNodeId}`
          : `ax-${child.nodeId}`;
      }),
    });
    for (const c of childAx) walk(c, depth + 1);
  };

  for (const root of childrenOf.get(null) ?? []) walk(root, 0);
  return out;
}

export class DesktopNavigatorSession {
  private browser?: Browser;
  private page?: Page;
  private client?: CDPSession;

  async start(): Promise<void> {
    this.browser = await chromium.launch({ headless: true });
    this.page = await this.browser.newPage();
    await this.page.setContent(fixtureHtml, { waitUntil: "load" });
    // Curtain: even in headless, paint the overlay so headed demos match.
    await this.page.evaluate(() => {
      const el = document.createElement("div");
      el.id = "__sn-curtain";
      el.setAttribute("aria-hidden", "true");
      el.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;font:16px system-ui;pointer-events:none;";
      el.textContent = "Content hidden — navigate via Semantic Navigator";
      document.documentElement.appendChild(el);
    });
    this.client = await this.page.context().newCDPSession(this.page);
    await this.client.send("Accessibility.enable");
    await this.client.send("DOM.enable");
    await this.client.send("DOM.getDocument", { depth: 0 });
  }

  async tree(): Promise<PanelNode[]> {
    const full = (await this.client!.send("Accessibility.getFullAXTree")) as {
      nodes: AxNode[];
    };
    return normalize(full.nodes);
  }

  async click(
    backendDOMNodeId: number,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const resolved = (await this.client!.send("DOM.resolveNode", {
        backendNodeId: backendDOMNodeId,
      })) as { object?: { objectId?: string } };
      const objectId = resolved.object?.objectId;
      if (!objectId) return { ok: false, error: "resolve failed" };
      await this.client!.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: `function () { if (this.click) this.click(); }`,
        returnByValue: true,
      });
      return { ok: true };
    } catch (err) {
      // Log details server-side only — never echo exception text to the
      // panel client (information-exposure hardening; the product protocol
      // must keep this rule too).
      console.error("[desktop-navigator] cdp click failed:", err);
      return { ok: false, error: "action failed" };
    }
  }

  async statusText(): Promise<string> {
    return this.page!.locator("#status").innerText();
  }

  async giftChecked(): Promise<boolean> {
    return this.page!.locator("#gift").isChecked();
  }

  async close(): Promise<void> {
    await this.client?.detach().catch(() => {});
    await this.browser?.close().catch(() => {});
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Local panel server — the only UI the auditor sees.
 *
 * Auth (R6 / panel protocol v0 invariant): loopback bind is NOT enough —
 * any local process, or a page doing DNS-rebinding-style requests to
 * localhost, could otherwise drive the audited (possibly authenticated)
 * browser through /api/click. A per-session bearer token is minted at start:
 * the panel page is served only with `?token=…` (the URL the operator is
 * handed), and every /api call must carry `authorization: Bearer …`.
 */
export async function startPanelServer(
  session: DesktopNavigatorSession,
  port = 0,
): Promise<{ port: number; token: string; close: () => Promise<void> }> {
  const token = randomUUID();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (url.pathname === "/" || url.pathname === "/panel") {
        if (url.searchParams.get("token") !== token) {
          res.writeHead(403);
          res.end("forbidden");
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(panelHtml);
        return;
      }
      if (req.headers.authorization !== `Bearer ${token}`) {
        json(res, { ok: false, error: "unauthorized" }, 401);
        return;
      }
      if (url.pathname === "/api/tree" && req.method === "GET") {
        const nodes = await session.tree();
        json(res, { nodes });
        return;
      }
      if (url.pathname === "/api/click" && req.method === "POST") {
        const body = JSON.parse(await readBody(req)) as {
          backendDOMNodeId?: number;
        };
        if (typeof body.backendDOMNodeId !== "number") {
          json(res, { ok: false, error: "backendDOMNodeId required" }, 400);
          return;
        }
        const result = await session.click(body.backendDOMNodeId);
        const nodes = await session.tree();
        json(res, { ...result, nodes, status: await session.statusText() });
        return;
      }
      res.writeHead(404);
      res.end("not found");
    } catch (err) {
      // CodeQL js/stack-trace-exposure: exception text can carry stack frames
      // and internal paths. Log server-side; return a generic error only.
      console.error("[desktop-navigator] panel request failed:", err);
      json(res, { ok: false, error: "internal error" }, 500);
    }
  });

  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind panel server");
  }
  return {
    port: address.port,
    token,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

function json(res: ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
