import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ALL_RULES } from "@real-a11y-dev/audit";
import type { Finding } from "@real-a11y-dev/audit";
import type {
  A11ySession,
  OpenOptions,
  PageSnapshot,
  SnapshotOptions,
} from "@real-a11y-dev/browser";
import {
  buildSnapshotPage,
  parseSnapshotArtifact,
  projectNativeTree,
} from "@real-a11y-dev/snapshot";
import { describe, it, expect, beforeEach } from "vitest";

import {
  buildServer,
  McpSessionManager,
  renderAudit,
  renderSnapshot,
  type BuildServerOptions,
} from "./server.js";

/** In-memory session that records calls and returns programmed responses. */
class FakeSession implements A11ySession {
  calls: { fn: string; rootSelector: string; args: unknown[] }[] = [];
  responses: Record<string, unknown> = {};
  snapshotResponse: PageSnapshot | null = null;
  opened: { url: string; options?: OpenOptions }[] = [];
  closed = 0;

  async open(url: string, options?: OpenOptions) {
    this.opened.push({ url, options });
    this.url = url;
    return { title: "Fake Title", url };
  }

  /** Where the fake page "is" — set by open(), and settable directly to stand
   *  in for an act tool having navigated. */
  url = "";
  currentUrl() {
    return this.url || undefined;
  }

  async call<T>(fn: string, rootSelector: string, args: unknown[] = []) {
    this.calls.push({ fn, rootSelector, args });
    return (this.responses[fn] ?? null) as T;
  }

  async snapshot(rootSelector: string, options: SnapshotOptions = {}) {
    this.calls.push({ fn: "snapshot", rootSelector, args: [options] });
    return (
      this.snapshotResponse ?? {
        findings: [],
        tree: "",
        outline: "(no headings)",
        tabOrder: "(nothing focusable)",
      }
    );
  }

  nativeResponse: { tree: string; pairs: string[] } = { tree: "", pairs: [] };
  async nativeAX() {
    this.calls.push({ fn: "nativeAX", rootSelector: "", args: [] });
    return this.nativeResponse;
  }

  // Typed off the interface itself so this fake needs no extra dependency.
  nativeTreeResponse: Awaited<ReturnType<A11ySession["nativeTree"]>> = {
    nodes: new Map(),
    rootId: "",
    source: { producer: "native" },
  };
  async nativeTree() {
    this.calls.push({ fn: "nativeTree", rootSelector: "", args: [] });
    return this.nativeTreeResponse;
  }

  // Typed off the interface. The act tools resolve their target from
  // `nativeTreeResponse` first, then dispatch here.
  actResponse: Awaited<ReturnType<A11ySession["act"]>> = { success: true };
  async act(request: Parameters<A11ySession["act"]>[0]) {
    this.calls.push({ fn: "act", rootSelector: "", args: [request] });
    return this.actResponse;
  }

  async close() {
    this.closed += 1;
    // The real BrowserSession drops its page here, so `currentUrl()` goes back
    // to undefined. A fake that kept reporting the last URL would make
    // "is anything open?" logic look right in tests and wrong in production.
    this.url = "";
  }
}

/** Build a flat native ExtractionResult: a `main` root with these children. */
function nativeTree(
  children: { role: string; name?: string; level?: string }[],
): FakeSession["nativeTreeResponse"] {
  const a11y = (role: string, name = "", level?: string) => ({
    role,
    name,
    description: "",
    states: {},
    properties: level ? { level } : {},
    isExposedToAT: true,
  });
  const ids = children.map((_, i) => `c${i}`);
  const entries = [
    [
      "root",
      {
        id: "root",
        parentId: null,
        childIds: ids,
        depth: 0,
        a11y: a11y("main"),
      },
    ],
    ...children.map((c, i) => [
      ids[i],
      {
        id: ids[i],
        parentId: "root",
        childIds: [],
        depth: 1,
        a11y: a11y(c.role, c.name, c.level),
      },
    ]),
  ];
  return {
    nodes: new Map(entries as never),
    rootId: "root",
    source: { producer: "native" },
  } as FakeSession["nativeTreeResponse"];
}

/** Wire a Client to a server built around `session`, over an in-memory pair. */
async function connect(session: A11ySession, options?: BuildServerOptions) {
  const server = buildServer(session, options);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

/**
 * Concatenate the text parts of a tool result.
 *
 * Typed from what `client.callTool` actually returns, rather than a hand-rolled
 * `{ content: { type, text? }[] }`. That approximation was wrong — the SDK's
 * content is a discriminated union (text / image / audio / resource), so `text`
 * exists on exactly one arm — and nothing noticed while this file was excluded
 * from typecheck. Narrowing on `type` is what the union actually requires.
 */
type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

function textOf(res: ToolResult): string {
  const content = res.content as { type: string; text?: string }[];
  return content.map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("");
}

describe("renderAudit", () => {
  it("summarizes a clean page", () => {
    expect(renderAudit([])).toMatch(/No accessibility issues found/);
  });

  it("renders a human summary and an embedded JSON block", () => {
    const findings: Finding[] = [
      {
        rule: "no-unlabeled-interactive",
        severity: "error",
        message: "Unlabeled interactive element: button <button>",
        role: "button",
        tagName: "BUTTON",
      },
    ];
    const out = renderAudit(findings);
    expect(out).toMatch(/1 issue\(s\) — 1 error\(s\), 0 warning\(s\)/);
    expect(out).toContain("no-unlabeled-interactive");
    // The fenced JSON must parse and carry the structured findings.
    const json = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json);
    expect(parsed.summary).toEqual({ total: 1, errors: 1, warnings: 0 });
    expect(parsed.findings[0].role).toBe("button");
  });
});

describe("MCP server wiring", () => {
  let session: FakeSession;

  beforeEach(() => {
    session = new FakeSession();
  });

  it("tells the agent the checkpoint store dies with the browser", async () => {
    // The store is deliberately cleared by close_browser, and the website docs
    // say so — but an agent only ever reads tool descriptions, so the promise
    // that checkpoints "survive navigation" read as "survive everything".
    const client = await connect(session);
    const tools = (await client.listTools()).tools;
    const byName = (n: string) => tools.find((t) => t.name === n)!;
    expect(byName("checkpoint_findings").description).toMatch(
      /do NOT survive close_browser/,
    );
    expect(byName("close_browser").description).toMatch(/DISCARDS/);
    // …and both point at the escape hatch rather than just stating the loss.
    expect(byName("checkpoint_findings").description).toMatch(
      /export_checkpoint/,
    );
    expect(byName("close_browser").description).toMatch(/export_checkpoint/);
  });

  it("never offers rootSelector as the remedy for a tool that dropped it", async () => {
    // The truncation note is appended to the ONE output where the agent has
    // already lost information and most needs a way forward. Naming a parameter
    // the tool no longer accepts spends that moment on a schema error. Each
    // read must advertise only the lever it actually has.
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    session.nativeTreeResponse = nativeTree([
      { role: "heading", name: "x".repeat(45_000), level: "1" },
    ]);

    const tree = textOf(
      (await client.callTool({
        name: "get_semantic_tree",
        arguments: {},
      })) as never,
    );
    expect(tree).toMatch(/output truncated at 40000 chars/);
    // Named as ruled OUT, never offered — an agent carrying the old schema in
    // context is exactly who reads this line, so silence would invite the retry
    // this is trying to prevent.
    expect(tree).toMatch(/takes no `rootSelector`/);
    expect(tree).not.toMatch(/Pass a narrower `rootSelector`/);
    expect(tree).toMatch(/get_heading_outline/); // a slice it CAN take

    // inspect_page carries both: its findings section takes a `rules` subset,
    // its tree section takes nothing.
    const inspect = textOf(
      (await client.callTool({
        name: "inspect_page",
        arguments: {},
      })) as never,
    );
    expect(inspect).toMatch(/output truncated at 40000 chars/);
    expect(inspect).toMatch(/`rules` subset/);
    expect(inspect).not.toMatch(/Pass a narrower `rootSelector`/);

    // …while the one tool that KEPT the selector still names it. Without this
    // half, deleting every mention of rootSelector would pass.
    session.responses.tabSequenceSnapshot = "y".repeat(45_000);
    const tabs = textOf(
      (await client.callTool({
        name: "get_tab_order",
        arguments: {},
      })) as never,
    );
    expect(tabs).toMatch(/output truncated at 40000 chars/);
    expect(tabs).toMatch(/Pass a narrower `rootSelector`/);
  });

  it("reports headless vs headful so a missing window isn't a mystery", async () => {
    // buildServer can't infer this — the bin owns the decision — so an unset
    // `headful` must still say "headless" rather than stay silent.
    const headlessClient = await connect(session);
    const headless = textOf(
      (await headlessClient.callTool({
        name: "open_page",
        arguments: { url: "https://example.com/" },
      })) as never,
    );
    expect(headless).toMatch(/headless/);
    expect(headless).toMatch(/REAL_A11Y_MCP_HEADFUL/);

    const headfulClient = await connect(new FakeSession(), { headful: true });
    const visible = textOf(
      (await headfulClient.callTool({
        name: "open_page",
        arguments: { url: "https://example.com/" },
      })) as never,
    );
    expect(visible).toMatch(/headful/);
    expect(visible).not.toMatch(/REAL_A11Y_MCP_HEADFUL/);
  });

  it("doesn't claim headless over a CDP attach, where the flag is inert", async () => {
    // `BrowserSession` ignores `headless` entirely when `cdpEndpoint` is set —
    // it reuses the running browser. So the launch flag describes a launch that
    // never happened: the attached Chrome usually HAS a window, and setting
    // REAL_A11Y_MCP_HEADFUL wouldn't open one. Offering it as the fix is the
    // exact confusion this reply set out to remove.
    const cdpClient = await connect(new FakeSession(), { cdpAttached: true });
    const attached = textOf(
      (await cdpClient.callTool({
        name: "open_page",
        arguments: { url: "https://example.com/" },
      })) as never,
    );
    expect(attached).toMatch(/attached to your running Chrome/);
    expect(attached).not.toMatch(/no window/);
    // The variable may be NAMED — to say it does nothing — but never as a fix.
    expect(attached).toMatch(/has no effect over CDP/);
    expect(attached).not.toMatch(/set REAL_A11Y_MCP_HEADFUL=1/);
  });

  it("CDP wins over headful — an attach never launched anything", async () => {
    // Both env vars can be set at once; `headful` is the one that's meaningless.
    const cdpClient = await connect(new FakeSession(), {
      cdpAttached: true,
      headful: true,
    });
    const attached = textOf(
      (await cdpClient.callTool({
        name: "open_page",
        arguments: { url: "https://example.com/" },
      })) as never,
    );
    expect(attached).toMatch(/attached to your running Chrome/);
    expect(attached).not.toMatch(/a window is open/);
  });

  it("points an unauthenticated server at the auth options it does have", async () => {
    // The capability exists but is env-only by design (a token must never be a
    // tool parameter). Env-only shouldn't mean invisible: an agent that hits a
    // logged-out page should be able to tell the user what to do.
    const anon = (await (await connect(session)).listTools()).tools.find(
      (t) => t.name === "open_page",
    )!;
    expect(anon.description).toMatch(/REAL_A11Y_MCP_STORAGE_STATE/);
    expect(anon.description).toMatch(/REAL_A11Y_MCP_CDP/);

    // An authenticated server says the opposite — don't try to log in.
    const authed = (
      await (
        await connect(new FakeSession(), { authenticated: true })
      ).listTools()
    ).tools.find((t) => t.name === "open_page")!;
    expect(authed.description).toMatch(/ALREADY AUTHENTICATED/);
    expect(authed.description).not.toMatch(/REAL_A11Y_MCP_STORAGE_STATE/);
  });

  it("doesn't call a CDP attach logged-out, or prescribe the attach it's using", async () => {
    // A CDP attach never carries a storage state — they're mutually exclusive —
    // so `authenticated` is false, and the anon branch used to fire: "NO saved
    // login, expect a logged-out view … restart with REAL_A11Y_MCP_CDP". Over
    // CDP that's wrong twice: `ensurePage` reuses the attached browser's own
    // context, so pages inherit whatever it's signed into, and the prescribed
    // fix is the setup already in force.
    const cdp = (
      await (
        await connect(new FakeSession(), { cdpAttached: true })
      ).listTools()
    ).tools.find((t) => t.name === "open_page")!;
    expect(cdp.description).not.toMatch(/will open as a logged-out view/);
    expect(cdp.description).not.toMatch(/restart the server with/);
    expect(cdp.description).toMatch(/sessions THAT browser holds/);
    // Still not a promise of auth — that Chrome may be signed into nothing,
    // and the honest instruction is to check what you actually got.
    expect(cdp.description).not.toMatch(/ALREADY AUTHENTICATED/);
    expect(cdp.description).toMatch(/sign in in that Chrome window/);
    // The one thing that stays true in every state: no credential parameter.
    expect(cdp.description).toMatch(/no credential parameter/);
  });

  it("a CDP open_page reply doesn't imply a known session either", async () => {
    const client = await connect(new FakeSession(), { cdpAttached: true });
    const reply = textOf(
      (await client.callTool({
        name: "open_page",
        arguments: { url: "https://example.com/" },
      })) as never,
    );
    expect(reply).toMatch(/whatever the attached Chrome holds/);
    expect(reply).not.toMatch(/storage state loaded/);
  });

  it("registers the audit-first tool surface", async () => {
    const client = await connect(session);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "audit_page",
        "checkpoint_tree",
        "click_element",
        "close_browser",
        "diff_findings",
        "diff_checkpoints",
        "diff_tree",
        "export_checkpoint",
        "focus_element",
        "get_heading_outline",
        "get_semantic_tree",
        "get_tab_order",
        "import_checkpoint",
        "inspect_page",
        "list_checkpoints",
        "list_elements",
        "list_sessions",
        "open_page",
        "checkpoint_findings",
        "type_text",
      ].sort(),
    );
  });

  it("list_elements takes no rootSelector — the native tree is whole-document", async () => {
    const client = await connect(session);
    const schema = (await client.listTools()).tools.find(
      (t) => t.name === "list_elements",
    )?.inputSchema;
    expect(Object.keys(schema?.properties ?? {})).toEqual([
      "filter",
      "session",
    ]);
    // A rejected extra property beats one that is silently ignored.
    const res = await client.callTool({
      name: "list_elements",
      arguments: { filter: "link", rootSelector: "nav" },
    });
    expect(session.calls.some((c) => c.fn === "listByRole")).toBe(false);
    expect(res).toBeDefined();
  });

  it("get_tab_order numbers the page bundle's canonical (unnumbered) output", async () => {
    // The page bundle returns the canonical unnumbered form; the tool adds the
    // ordinals at render so an agent can reference "stop 2".
    session.responses.tabSequenceSnapshot = 'link "Home"\nbutton "Go"';
    const client = await connect(session);
    const res = await client.callTool({
      name: "get_tab_order",
      arguments: { rootSelector: "body" },
    });
    expect(textOf(res)).toBe('01. link "Home"\n02. button "Go"');
  });

  it("advertises the [focused] marker in the get_* / inspect descriptions", async () => {
    const client = await connect(session);
    const tools = (await client.listTools()).tools;
    const desc = (name: string) =>
      tools.find((t) => t.name === name)?.description ?? "";
    expect(desc("get_semantic_tree")).toMatch(/\[focused\]/);
    expect(desc("get_tab_order")).toMatch(/\[focused\]/);
    expect(desc("inspect_page")).toMatch(/\[focused\]/);
  });

  // ── the view + audit tools read Chromium's own tree ──────────────────────

  // A heading plus an UNLABELED button — enough for the Node-side audit (via
  // projectNativeTree) to flag `no-unlabeled-interactive`.
  const nativeTreeWithUnlabeledButton = nativeTree([
    { role: "heading", name: "Player", level: "1" },
    { role: "button" },
  ]);
  // Nothing for the rules to flag: one labeled h1, no controls.
  const nativeTreeCleanHeading = nativeTree([
    { role: "heading", name: "Player", level: "1" },
  ]);
  // Carries a `generic` container, which only surfaces under includeGeneric.
  const nativeTreeWithGeneric = nativeTree([
    { role: "heading", name: "Player", level: "1" },
    { role: "generic" },
  ]);

  it("get_semantic_tree serializes the native tree", async () => {
    session.nativeTreeResponse = nativeTreeWithUnlabeledButton;
    const client = await connect(session);
    const res = await client.callTool({
      name: "get_semantic_tree",
      arguments: {},
    });
    const out = textOf(res);
    expect(out).toContain('heading "Player"');
    expect(out).toContain("button"); // the unlabeled button node
    expect(session.calls.some((c) => c.fn === "nativeTree")).toBe(true);
    // Not the in-page auditSnapshot DOM path.
    expect(session.calls.some((c) => c.fn === "auditSnapshot")).toBe(false);
  });

  it("get_heading_outline derives the outline from the native tree", async () => {
    session.nativeTreeResponse = nativeTreeWithUnlabeledButton;
    const client = await connect(session);
    const res = await client.callTool({
      name: "get_heading_outline",
      arguments: {},
    });
    expect(textOf(res)).toContain("Player");
    expect(session.calls.some((c) => c.fn === "nativeTree")).toBe(true);
    expect(session.calls.some((c) => c.fn === "outlineSnapshot")).toBe(false);
  });

  it("list_elements lists from the native tree", async () => {
    session.nativeTreeResponse = nativeTreeWithUnlabeledButton;
    const client = await connect(session);
    const res = await client.callTool({
      name: "list_elements",
      arguments: { filter: "heading" },
    });
    expect(textOf(res)).toContain('heading "Player"');
    expect(session.calls.some((c) => c.fn === "nativeTree")).toBe(true);
    // Native lists in Node — never the in-page listByRole call.
    expect(session.calls.some((c) => c.fn === "listByRole")).toBe(false);
  });

  it("audit_page audits the native tree, not the DOM path", async () => {
    session.nativeTreeResponse = nativeTreeWithUnlabeledButton;
    const client = await connect(session);
    const res = await client.callTool({
      name: "audit_page",
      arguments: {},
    });
    expect(textOf(res)).toContain("no-unlabeled-interactive");
    // It read the native tree — not the in-page collectFindings DOM path.
    expect(session.calls.some((c) => c.fn === "nativeTree")).toBe(true);
    expect(session.calls.some((c) => c.fn === "collectFindings")).toBe(false);
  });

  it("inspect_page omits the tab-order section rather than showing it empty", async () => {
    session.nativeTreeResponse = nativeTreeWithUnlabeledButton;
    const client = await connect(session);
    const res = await client.callTool({
      name: "inspect_page",
      arguments: {},
    });
    const out = textOf(res);
    // An empty "Tab order" block reads as "nothing here is focusable" — a very
    // different claim from "this tree doesn't carry tab order". Say neither.
    expect(out).not.toMatch(/## Tab order/);
    expect(out).toMatch(/get_tab_order/);
    expect(out).toContain("Player"); // the tree/outline still render
    expect(session.calls.some((c) => c.fn === "nativeTree")).toBe(true);
  });

  it("open_page reports the resolved title and url, defaulting the wait", async () => {
    const client = await connect(session);
    const res = await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    expect(session.opened[0].url).toBe("https://example.com/");
    // zod defaults are applied before the handler runs.
    expect(session.opened[0].options).toEqual({
      waitUntil: "load",
      settleMs: 0,
    });
    expect(textOf(res)).toMatch(/Fake Title/);
  });

  it("does not signal a session by default (no auth configured)", async () => {
    const client = await connect(session);
    const res = await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    expect(textOf(res)).not.toMatch(/authenticated session/);
    const openTool = (await client.listTools()).tools.find(
      (t) => t.name === "open_page",
    );
    expect(openTool?.description).not.toMatch(/already authenticated/i);
  });

  it("signals a loaded session in open_page's result and description", async () => {
    const client = await connect(session, { authenticated: true });
    const res = await client.callTool({
      name: "open_page",
      arguments: { url: "https://app.example.com/dashboard" },
    });
    // Boolean fact only — never the storage-state path or its contents.
    expect(textOf(res)).toMatch(/authenticated session: storage state loaded/);
    const openTool = (await client.listTools()).tools.find(
      (t) => t.name === "open_page",
    );
    expect(openTool?.description).toMatch(/already authenticated/i);
    expect(openTool?.description).toMatch(/do not try to log in/i);
  });

  it("open_page forwards waitUntil and settleMs settle options", async () => {
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: {
        url: "https://spa.example/",
        waitUntil: "networkidle",
        settleMs: 1500,
      },
    });
    expect(session.opened[0].options).toEqual({
      waitUntil: "networkidle",
      settleMs: 1500,
    });
  });

  it("open_page forwards a device for mobile emulation and notes it", async () => {
    const client = await connect(session);
    const res = await client.callTool({
      name: "open_page",
      arguments: { url: "https://m.example/", device: "iPhone 13" },
    });
    expect(session.opened[0].options).toMatchObject({ device: "iPhone 13" });
    expect(textOf(res)).toMatch(/\[iPhone 13\]/);
  });

  it("audit_page forwards the rule subset to the native audit", async () => {
    // Violates BOTH rules: h1 → h3 skips a level, and the button is unlabeled.
    session.nativeTreeResponse = nativeTree([
      { role: "heading", name: "Home", level: "1" },
      { role: "heading", name: "Deep", level: "3" },
      { role: "button" },
    ]);
    const client = await connect(session);
    const res = await client.callTool({
      name: "audit_page",
      arguments: { rules: ["heading-order"] },
    });
    // Only the requested rule ran: the unlabeled button is NOT reported.
    const out = textOf(res);
    expect(out).toMatch(/heading-order/);
    expect(out).not.toMatch(/no-unlabeled-interactive/);
    expect(session.calls.some((c) => c.fn === "collectFindings")).toBe(false);
  });

  it("audit_page reports a clean page when the tree has no violations", async () => {
    session.nativeTreeResponse = nativeTreeCleanHeading;
    const client = await connect(session);
    const res = await client.callTool({ name: "audit_page", arguments: {} });
    expect(textOf(res)).toMatch(/No accessibility issues found/);
  });

  it("audit_page runs every rule when none are given", async () => {
    session.nativeTreeResponse = nativeTreeWithUnlabeledButton;
    const client = await connect(session);
    const res = await client.callTool({ name: "audit_page", arguments: {} });
    expect(textOf(res)).toMatch(/no-unlabeled-interactive/);
  });

  it("audit_page treats an empty rules array as 'run all rules'", async () => {
    // `[]` means "no filter given", not "audit nothing" — a native audit must
    // never silently pass a page the full rule set would flag.
    session.nativeTreeResponse = nativeTreeWithUnlabeledButton;
    const client = await connect(session);
    const res = await client.callTool({
      name: "audit_page",
      arguments: { rules: [] },
    });
    expect(textOf(res)).toMatch(/no-unlabeled-interactive/);
  });

  it("audit_page accepts every rule in ALL_RULES (schema can't drift)", async () => {
    session.responses.collectFindings = [] satisfies Finding[];
    const client = await connect(session);
    // A hand-maintained rule enum once dropped `image-alt`; drive the schema
    // from ALL_RULES so any rule the engine runs is also selectable here.
    for (const rule of ALL_RULES) {
      const res = await client.callTool({
        name: "audit_page",
        arguments: { rules: [rule] },
      });
      expect(res.isError, `rule ${rule} rejected by schema`).toBeFalsy();
    }
  });

  it("audit_page rejects a rule name the engine doesn't define", async () => {
    session.responses.collectFindings = [] satisfies Finding[];
    const client = await connect(session);
    const res = await client.callTool({
      name: "audit_page",
      arguments: { rules: ["not-a-real-rule"] },
    });
    expect(res.isError).toBe(true);
  });

  it("get_semantic_tree forwards includeGeneric to the native projection", async () => {
    session.nativeTreeResponse = nativeTreeWithGeneric;
    const client = await connect(session);
    const bare = textOf(
      await client.callTool({ name: "get_semantic_tree", arguments: {} }),
    );
    expect(bare).not.toContain("generic");
    const withGeneric = textOf(
      await client.callTool({
        name: "get_semantic_tree",
        arguments: { includeGeneric: true },
      }),
    );
    expect(withGeneric).toContain("generic");
    expect(session.calls.some((c) => c.fn === "auditSnapshot")).toBe(false);
  });

  it("get_semantic_tree shows a placeholder for an empty tree", async () => {
    session.responses.auditSnapshot = "";
    const client = await connect(session);
    const res = await client.callTool({
      name: "get_semantic_tree",
      arguments: {},
    });
    expect(textOf(res)).toMatch(/empty tree/);
  });

  it("close_browser closes the session once it has been used", async () => {
    const client = await connect(session);
    // Nothing has run and no page is open: there is nothing to close, and a
    // browser that was never launched must not be close()d just to say so.
    const fresh = await client.callTool({
      name: "close_browser",
      arguments: {},
    });
    expect(textOf(fresh)).toMatch(/was not open/);
    expect(session.closed).toBe(0);

    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    const res = await client.callTool({ name: "close_browser", arguments: {} });
    expect(textOf(res)).toMatch(/"default" closed/);
    expect(session.closed).toBe(1);
  });

  it("inspect_page derives findings, tree and outline from ONE native read", async () => {
    session.nativeTreeResponse = nativeTreeWithUnlabeledButton;
    const client = await connect(session);
    const res = await client.callTool({
      name: "inspect_page",
      arguments: { includeGeneric: true, rules: ["no-unlabeled-interactive"] },
    });

    // Exactly one extraction — that is the whole promise of this tool, and it
    // is why there is no tab-order section: a second, DOM-derived read would
    // describe a different instant.
    expect(session.calls.filter((c) => c.fn === "nativeTree")).toHaveLength(1);
    expect(session.calls.some((c) => c.fn === "snapshot")).toBe(false);

    const out = textOf(res);
    expect(out).toMatch(/Single-extraction snapshot/);
    expect(out).toMatch(/no-unlabeled-interactive/); // findings
    expect(out).toMatch(/## Semantic tree/);
    expect(out).toMatch(/## Heading outline/);
    expect(out).toContain("Player");
    expect(out).not.toMatch(/## Tab order/);
  });
});

describe("renderAudit grouping", () => {
  it("groups identical findings with a count and lists their locators", () => {
    const findings: Finding[] = [
      {
        rule: "no-unlabeled-interactive",
        severity: "error",
        message: "Unlabeled interactive element: link <a>",
        locator: "#a1",
        context: 'href="/1"',
      },
      {
        rule: "no-unlabeled-interactive",
        severity: "error",
        message: "Unlabeled interactive element: link <a>",
        locator: "#a2",
        context: 'href="/2"',
      },
    ];
    const out = renderAudit(findings);
    expect(out).toMatch(/link <a> \(×2\)/); // one grouped row, not two
    expect(out).toContain("#a1");
    expect(out).toContain("#a2");
  });

  it("orders errors before warnings", () => {
    const out = renderAudit([
      { rule: "heading-order", severity: "warning", message: "a warning" },
      {
        rule: "no-unlabeled-interactive",
        severity: "error",
        message: "an error",
      },
    ]);
    expect(out.indexOf("[error]")).toBeLessThan(out.indexOf("[warning]"));
  });

  it("caps a group's listed locators and notes the remainder", () => {
    const findings: Finding[] = Array.from({ length: 10 }, (_, i) => ({
      rule: "no-unlabeled-interactive",
      severity: "error" as const,
      message: "Unlabeled interactive element: link <a>",
      locator: `#a${i}`,
    }));
    const out = renderAudit(findings);
    // The cap applies to the human summary; the JSON block still carries all.
    const summary = out.slice(0, out.indexOf("```json"));
    expect(summary).toMatch(/link <a> \(×10\)/); // one grouped row
    expect(summary).toContain("#a0");
    expect(summary).toContain("#a7"); // first 8 locators shown
    expect(summary).not.toContain("#a8"); // 9th onward elided
    expect(summary).toMatch(/… \+2 more/); // remainder noted
  });
});

describe("renderSnapshot", () => {
  it("counts tree nodes and renders the findings, tree and outline", () => {
    const out = renderSnapshot({
      findings: [],
      tree: "main\n  button\n  link",
      outline: "h1 Title",
    });
    expect(out).toMatch(/3 tree nodes/);
    expect(out).toMatch(/No accessibility issues found/);
    expect(out).toMatch(/## Semantic tree/);
    expect(out).toMatch(/## Heading outline/);
    expect(out).toContain("h1 Title");
  });

  it("has no tab-order section, and says where to get one", () => {
    // An empty "## Tab order" block would read as "nothing on this page is
    // focusable" — the alarming reading of a view that simply wasn't measured.
    const out = renderSnapshot({
      findings: [],
      tree: "main",
      outline: "(no headings)",
    });
    expect(out).not.toMatch(/## Tab order/);
    expect(out).not.toMatch(/tab stops/);
    expect(out).toMatch(/get_tab_order/);
  });
});

describe("checkpoints", () => {
  let session: FakeSession;
  beforeEach(() => {
    session = new FakeSession();
  });

  /** A native tree with a valid h1 plus `n` UNLABELED buttons. The h1 keeps
   *  heading-order quiet, so the finding count is exactly `n`. */
  const unlabeledButtons = (n: number) =>
    nativeTree([
      { role: "heading", name: "Home", level: "1" },
      ...Array.from({ length: n }, () => ({ role: "button" })),
    ]);

  it("checkpoint_findings then diff_findings surfaces a NEW finding after a change", async () => {
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    session.nativeTreeResponse = unlabeledButtons(1);
    const saved = textOf(
      await client.callTool({
        name: "checkpoint_findings",
        arguments: { name: "before" },
      }),
    );
    expect(saved).toMatch(/"before" saved: 1 finding/);

    // A change introduces a second unlabeled button.
    session.nativeTreeResponse = unlabeledButtons(2);
    const diff = textOf(
      await client.callTool({
        name: "diff_findings",
        arguments: { name: "before" },
      }),
    );
    expect(diff).toMatch(/1 new/);
    expect(diff).toMatch(/NEW — gates CI/);
  });

  it("diff_findings errors when the checkpoint is missing", async () => {
    const client = await connect(session);
    const res = await client.callTool({
      name: "diff_findings",
      arguments: { name: "nope" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/No checkpoint named "nope"/);
  });

  it("close_browser clears the store", async () => {
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    session.nativeTreeResponse = unlabeledButtons(1);
    await client.callTool({
      name: "checkpoint_findings",
      arguments: { name: "before" },
    });
    await client.callTool({ name: "close_browser", arguments: {} });
    const list = textOf(
      await client.callTool({ name: "list_checkpoints", arguments: {} }),
    );
    expect(list).toMatch(/No checkpoints saved/);
  });

  // The correctness invariant: an MCP checkpoint's fingerprints are identical to
  // the CLI's for the same page — both flow through the shared buildSnapshotPage.
  it("export_checkpoint fingerprints match the CLI's buildSnapshotPage (golden)", async () => {
    const tree = unlabeledButtons(2);
    const url = "https://example.com/";
    const name = "home";

    // The CLI path (cli/commands/snapshot.ts): projectNativeTree, then assemble
    // with tabOrder:false. Both tools MUST read the same producer — a checkpoint
    // captured by one is diffed by the other, and cross-producer findings would
    // silently classify as new+fixed.
    const cliPage = buildSnapshotPage(name, url, projectNativeTree(tree), {
      root: "body",
      tabOrder: false,
    });

    // The MCP path: open → save → export, then parse the artifact back.
    session.nativeTreeResponse = tree;
    const client = await connect(session);
    await client.callTool({ name: "open_page", arguments: { url } });
    await client.callTool({ name: "checkpoint_findings", arguments: { name } });
    const exported = textOf(
      await client.callTool({
        name: "export_checkpoint",
        arguments: { name },
      }),
    );
    const artifact = parseSnapshotArtifact(exported);
    const mcpPage = artifact.pages[0];

    expect(mcpPage.findings.length).toBe(2);
    expect(mcpPage.findings.map((f) => f.fingerprint)).toEqual(
      cliPage.findings.map((f) => f.fingerprint),
    );
    // …and the artifact declares what it measured, so whatever diffs it next
    // reads the missing tabs view as "not measured", not "all stops removed".
    expect(artifact.meta.views).toEqual(["tree", "outline"]);
    expect(mcpPage.tabs).toBeUndefined();
  });

  it("diff_findings re-snapshots with the rules the checkpoint was saved with", async () => {
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    // Saved under heading-order only, on a page with no headings: 0 findings.
    session.nativeTreeResponse = unlabeledButtons(0);
    await client.callTool({
      name: "checkpoint_findings",
      arguments: { name: "hp", rules: ["heading-order"] },
    });
    // The page gains two unlabeled buttons. The re-snapshot must carry the SAME
    // rule subset — running all rules would surface them as spurious NEW.
    session.nativeTreeResponse = unlabeledButtons(2);
    const diff = textOf(
      await client.callTool({
        name: "diff_findings",
        arguments: { name: "hp" },
      }),
    );
    expect(diff).toMatch(/0 new/);
    expect(diff).not.toMatch(/no-unlabeled-interactive/);
  });

  it("export_checkpoint round-trips as valid JSON for a normal page", async () => {
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    session.nativeTreeResponse = unlabeledButtons(1);
    await client.callTool({
      name: "checkpoint_findings",
      arguments: { name: "ok" },
    });
    const exported = textOf(
      await client.callTool({
        name: "export_checkpoint",
        arguments: { name: "ok" },
      }),
    );
    expect(() => parseSnapshotArtifact(exported)).not.toThrow();
  });

  it("export_checkpoint fails cleanly instead of truncating a too-large artifact", async () => {
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    // The tree field is not length-capped; make it exceed the 40k output cap.
    session.nativeTreeResponse = nativeTree([
      { role: "heading", name: "x".repeat(45_000), level: "1" },
    ]);
    await client.callTool({
      name: "checkpoint_findings",
      arguments: { name: "big" },
    });
    const res = await client.callTool({
      name: "export_checkpoint",
      arguments: { name: "big" },
    });
    expect(res.isError).toBe(true);
    const message = textOf(res);
    expect(message).toMatch(/too large to export inline/);
    // And the way out has to be one that still exists. `checkpoint_findings`
    // lost its rootSelector in this migration, so "re-save it with a narrower
    // rootSelector" hands the agent a schema error; the tree size is broken out
    // because `rules` shrinks the findings and never the tree.
    expect(message).not.toMatch(/narrower rootSelector/);
    expect(message).toMatch(/the tree alone is \d+ KB/);
    expect(message).toMatch(/diff_findings \/ diff_checkpoints/);
    expect(message).toMatch(/real-a11y snapshot <url> --output/);
  });

  it("import under a new label then diff_findings of an unchanged page reports no change", async () => {
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    session.nativeTreeResponse = unlabeledButtons(1);
    // Save as "home" and export — the artifact's page name is "home".
    await client.callTool({
      name: "checkpoint_findings",
      arguments: { name: "home" },
    });
    const artifact = textOf(
      await client.callTool({
        name: "export_checkpoint",
        arguments: { name: "home" },
      }),
    );
    // Import under a DIFFERENT label — artifact page name ("home") ≠ label.
    await client.callTool({
      name: "import_checkpoint",
      arguments: { name: "baseline", artifact },
    });
    // The live page is unchanged, so the diff must be 0 new / 0 fixed — not
    // every finding double-counted as NEW+FIXED from a name-join miss.
    const diff = textOf(
      await client.callTool({
        name: "diff_findings",
        arguments: { name: "baseline" },
      }),
    );
    expect(diff).toMatch(/0 new, 0 fixed/);
  });

  it("a DOM-era imported base does not report every tab stop as removed", async () => {
    // The migration hazard, end to end: a base captured when snapshots carried
    // a tabs view, diffed against a native head that has none. Without the
    // measured-views signal this reports "Keyboard tab stop removed" once per
    // focusable element — the tool's most safety-critical statement, fired at
    // volume, on a page where nothing changed.
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    session.nativeTreeResponse = unlabeledButtons(1);
    await client.callTool({
      name: "checkpoint_findings",
      arguments: { name: "head" },
    });
    const legacy = JSON.parse(
      textOf(
        await client.callTool({
          name: "export_checkpoint",
          arguments: { name: "head" },
        }),
      ),
    );
    // Rewrite it into a DOM-era artifact: a tabs view, and no meta.views.
    delete legacy.meta.views;
    legacy.pages[0].tabs = 'link "Home"\nbutton "Save"\nlink "Docs"';
    await client.callTool({
      name: "import_checkpoint",
      arguments: { name: "base", artifact: JSON.stringify(legacy) },
    });

    const diff = textOf(
      await client.callTool({
        name: "diff_findings",
        arguments: { name: "base" },
      }),
    );
    expect(diff).not.toMatch(/tab stop removed/i);
    expect(diff).not.toMatch(/no longer keyboard-focusable/i);
    expect(diff).toMatch(/0 new, 0 fixed/);
  });

  it("diff_tree re-extracts with the root the tree checkpoint used", async () => {
    session.responses.checkpointTree = "Tree checkpoint captured — 12 node(s).";
    session.responses.diffSinceCheckpoint = '+ button "Save"';
    const client = await connect(session);
    await client.callTool({
      name: "checkpoint_tree",
      arguments: { rootSelector: "[role=dialog]" },
    });
    // No rootSelector on the diff — it must reuse the captured root rather than
    // silently widening to <body> and reporting the rest of the page as added.
    const res = await client.callTool({
      name: "diff_tree",
      arguments: {},
    });
    const call = session.calls
      .filter((c) => c.fn === "diffSinceCheckpoint")
      .at(-1);
    expect(call?.rootSelector).toBe("[role=dialog]");
    expect(textOf(res)).toContain('+ button "Save"');
  });

  it("a tree checkpoint does not survive navigation", async () => {
    session.responses.checkpointTree = "Tree checkpoint captured — 3 node(s).";
    const client = await connect(session);
    await client.callTool({
      name: "checkpoint_tree",
      arguments: { rootSelector: "[role=dialog]" },
    });
    // Navigating replaces the page bundle, wiping the in-page tree; the server
    // must forget the captured root too rather than reusing a stale one.
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/other" },
    });
    await client.callTool({
      name: "diff_tree",
      arguments: {},
    });
    const call = session.calls
      .filter((c) => c.fn === "diffSinceCheckpoint")
      .at(-1);
    expect(call?.rootSelector).toBe("body");
  });

  it("re-exporting an imported DOM-era checkpoint keeps its tabs view", async () => {
    // export_checkpoint must read the measured views off the PAGE, not assume
    // "native, so no tabs". A checkpoint loaded from a DOM-era artifact still
    // carries one; declaring otherwise would drop that data on re-export, and
    // the next reader would have no way to know it was ever measured.
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    session.nativeTreeResponse = unlabeledButtons(1);
    await client.callTool({
      name: "checkpoint_findings",
      arguments: { name: "seed" },
    });
    const legacy = JSON.parse(
      textOf(
        await client.callTool({
          name: "export_checkpoint",
          arguments: { name: "seed" },
        }),
      ),
    );
    delete legacy.meta.views;
    legacy.pages[0].tabs = 'link "Home"';

    await client.callTool({
      name: "import_checkpoint",
      arguments: { name: "legacy", artifact: JSON.stringify(legacy) },
    });
    const round = parseSnapshotArtifact(
      textOf(
        await client.callTool({
          name: "export_checkpoint",
          arguments: { name: "legacy" },
        }),
      ),
    );
    expect(round.meta.views).toEqual(["tree", "outline", "tabs"]);
    expect(round.pages[0].tabs).toBe('link "Home"');
  });

  it("says so when an imported base was captured at a narrower scope", async () => {
    // Reads are whole-document now, so a live re-snapshot is always `body`.
    // An imported DOM-era base may have been taken at `[role=dialog]` — the
    // old findings still match by fingerprint (nothing reads as fixed) while
    // everything OUTSIDE that subtree arrives as NEW, the class that gates CI.
    // The diff is still worth showing; the agent just has to be told.
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    session.nativeTreeResponse = unlabeledButtons(1);
    await client.callTool({
      name: "checkpoint_findings",
      arguments: { name: "seed" },
    });
    const scoped = JSON.parse(
      textOf(
        await client.callTool({
          name: "export_checkpoint",
          arguments: { name: "seed" },
        }),
      ),
    );
    scoped.pages[0].root = "[role=dialog]";
    await client.callTool({
      name: "import_checkpoint",
      arguments: { name: "dialog", artifact: JSON.stringify(scoped) },
    });

    const out = textOf(
      await client.callTool({
        name: "diff_findings",
        arguments: { name: "dialog" },
      }),
    );
    expect(out).toMatch(/scope changed/);
    expect(out).toMatch(/\[role=dialog\]/);
    expect(out).toMatch(/appear as NEW/);
  });

  it("records the LIVE url on a checkpoint, not the one open_page landed on", async () => {
    // `click_element` can navigate. Recording the opened address would put the
    // wrong URL on the page — and, since the diff compares these, would leave a
    // diff across two genuinely different pages looking like one page twice.
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/pricing" },
    });
    session.nativeTreeResponse = unlabeledButtons(1);
    session.url = "https://example.com/careers"; // as if an act tool navigated
    const artifact = JSON.parse(
      textOf(
        await client.callTool({
          name: "checkpoint_findings",
          arguments: { name: "after-click" },
        }),
      ) &&
        textOf(
          await client.callTool({
            name: "export_checkpoint",
            arguments: { name: "after-click" },
          }),
        ),
    );
    expect(artifact.pages[0].url).toBe("https://example.com/careers");
  });

  it("suppresses the structural summary when the diff spans two pages", async () => {
    // Checkpoints survive navigation by design, so this is easy to do by
    // accident: checkpoint one route, click through to another, diff. The
    // findings diff is still meaningful; the structural summary would describe a
    // whole-page rewrite, which is noise.
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/pricing" },
    });
    session.nativeTreeResponse = unlabeledButtons(1);
    await client.callTool({
      name: "checkpoint_findings",
      arguments: { name: "pricing" },
    });

    // Navigate (as an act tool would) and change the structure.
    session.url = "https://example.com/careers";
    session.nativeTreeResponse = nativeTree([
      { role: "heading", name: "Careers", level: "1" },
      { role: "button" },
      { role: "link", name: "Apply" },
    ]);
    const out = textOf(
      await client.callTool({
        name: "diff_findings",
        arguments: { name: "pricing" },
      }),
    );
    expect(out).toMatch(/different page/);
    expect(out).toContain("https://example.com/pricing");
    expect(out).toContain("https://example.com/careers");
    expect(out).not.toMatch(/Structural changes/);
  });

  it("keeps the structural summary across two deploys of the same route", async () => {
    // The cross-deploy diff is the documented workflow for these tools —
    // checkpoint prod, open preview, diff. Only the origin differs there, and
    // the structural summary is the whole point, so it must survive.
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/pricing" },
    });
    session.nativeTreeResponse = unlabeledButtons(1);
    await client.callTool({
      name: "checkpoint_findings",
      arguments: { name: "prod" },
    });

    session.url = "https://staging.example.com/pricing";
    session.nativeTreeResponse = nativeTree([
      { role: "heading", name: "Home", level: "1" },
      { role: "button" },
      { role: "link", name: "Docs" },
    ]);
    const out = textOf(
      await client.callTool({
        name: "diff_findings",
        arguments: { name: "prod" },
      }),
    );
    expect(out).not.toMatch(/different page/);
    expect(out).toMatch(/Structural changes/);
  });

  it("stays quiet when both sides were captured whole-document", async () => {
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    session.nativeTreeResponse = unlabeledButtons(1);
    await client.callTool({
      name: "checkpoint_findings",
      arguments: { name: "same" },
    });
    const out = textOf(
      await client.callTool({
        name: "diff_findings",
        arguments: { name: "same" },
      }),
    );
    expect(out).not.toMatch(/scope changed/);
  });

  it("import_checkpoint rejects a partial (--only) artifact", async () => {
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    session.nativeTreeResponse = unlabeledButtons(1);
    await client.callTool({
      name: "checkpoint_findings",
      arguments: { name: "home" },
    });
    const full = textOf(
      await client.callTool({
        name: "export_checkpoint",
        arguments: { name: "home" },
      }),
    );
    // Mark it views-only, as `real-a11y snapshot --only views` would: the
    // findings axis is filtered away and would read as everything-new.
    const partial = JSON.parse(full);
    partial.meta.only = "views";
    partial.pages[0].findings = [];
    const res = await client.callTool({
      name: "import_checkpoint",
      arguments: { name: "partial", artifact: JSON.stringify(partial) },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/partial snapshot/);
  });
});

describe("act tools (click_element / type_text / focus_element)", () => {
  let session: FakeSession;

  /**
   * A native-shaped tree with the shapes the targeting policy branches on: a
   * synthesized root (no backing DOM element), a duplicate-named button pair,
   * a plain button, a text field, and a disabled button.
   */
  function actableTree(): FakeSession["nativeTreeResponse"] {
    const node = (
      id: string,
      role: string,
      name: string,
      states: Record<string, string | boolean> = {},
    ) => ({
      id,
      parentId: id === "ax-1" ? null : "ax-1",
      childIds: [] as string[],
      depth: id === "ax-1" ? 0 : 1,
      a11y: {
        role,
        name,
        description: "",
        states,
        properties: {},
        isExposedToAT: true,
      },
    });
    const nodes = [
      node("ax-1", "RootWebArea", "Fixture"),
      node("ax-dom-10", "button", "Save"),
      node("ax-dom-11", "button", "Save"),
      node("ax-dom-12", "button", "Go"),
      node("ax-dom-13", "textbox", "Email"),
      node("ax-dom-14", "button", "Delete", { disabled: true }),
    ];
    nodes[0].childIds = nodes.slice(1).map((n) => n.id);
    return {
      nodes: new Map(nodes.map((n) => [n.id, n])),
      rootId: "ax-1",
      source: { producer: "native" },
    };
  }

  beforeEach(() => {
    session = new FakeSession();
    session.nativeTreeResponse = actableTree();
  });

  it("click_element resolves against a FRESH native tree, then dispatches", async () => {
    const client = await connect(session);
    const res = await client.callTool({
      name: "click_element",
      arguments: { role: "button", name: "Go" },
    });
    // Resolution precedes dispatch — and no node id was ever sent by the agent.
    expect(session.calls.map((c) => c.fn)).toEqual(["nativeTree", "act"]);
    expect(session.calls[1].args[0]).toEqual({
      nodeId: "ax-dom-12",
      action: "click",
    });
    expect(textOf(res)).toMatch(/Clicked button "Go"/);
  });

  it("matches names case-insensitively and whitespace-normalized", async () => {
    const client = await connect(session);
    const res = await client.callTool({
      name: "click_element",
      arguments: { role: "button", name: "  gO \n" },
    });
    expect(textOf(res)).toMatch(/Clicked button "Go"/);
  });

  it("ambiguous matches list nth candidates and dispatch nothing", async () => {
    const client = await connect(session);
    const res = await client.callTool({
      name: "click_element",
      arguments: { role: "button", name: "Save" },
    });
    expect(res.isError).toBe(true);
    const out = textOf(res);
    expect(out).toMatch(/2 button\(s\) match/);
    expect(out).toMatch(/nth=1 · button "Save"/);
    expect(out).toMatch(/nth=2 · button "Save"/);
    expect(session.calls.some((c) => c.fn === "act")).toBe(false);
  });

  it("nth picks among the filtered matches (1-based, document order)", async () => {
    const client = await connect(session);
    await client.callTool({
      name: "click_element",
      arguments: { role: "button", name: "Save", nth: 2 },
    });
    const act = session.calls.find((c) => c.fn === "act");
    expect(act?.args[0]).toMatchObject({ nodeId: "ax-dom-11" });
  });

  it("an absent role is not-found with a remedy, before any dispatch", async () => {
    const client = await connect(session);
    const res = await client.callTool({
      name: "click_element",
      arguments: { role: "slider", name: "Volume" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(
      /No slider named "Volume" in the accessibility tree/,
    );
    expect(textOf(res)).toMatch(/get_semantic_tree/);
    expect(textOf(res)).toMatch(/accessibility finding/);
    expect(session.calls.some((c) => c.fn === "act")).toBe(false);
  });

  it("a name miss on a present role counts the role-only matches", async () => {
    const client = await connect(session);
    const res = await client.callTool({
      name: "click_element",
      arguments: { role: "button", name: "Nope" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/4 button\(s\) with other names exist/);
  });

  it("a synthesized node (no backing DOM element) is refused", async () => {
    const client = await connect(session);
    const res = await client.callTool({
      name: "click_element",
      arguments: { role: "RootWebArea" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/no backing DOM element/);
    expect(session.calls.some((c) => c.fn === "act")).toBe(false);
  });

  it("a disabled target is refused with the cause, not clicked into a void", async () => {
    const client = await connect(session);
    const res = await client.callTool({
      name: "click_element",
      arguments: { role: "button", name: "Delete" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(
      /is disabled — the page would ignore the click/,
    );
    expect(session.calls.some((c) => c.fn === "act")).toBe(false);
  });

  it("rewrites the backend's stale-node remedy to 'retry the tool'", async () => {
    // "re-read the tree and retry" presumes a caller holding node ids; the
    // agent never had one, so the retry IS the re-read.
    session.actResponse = {
      success: false,
      error:
        'could not resolve node "ax-dom-12" to a live DOM element — re-read the tree and retry',
    };
    const client = await connect(session);
    const res = await client.callTool({
      name: "click_element",
      arguments: { role: "button", name: "Go" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/Retry click_element/);
    expect(textOf(res)).not.toMatch(/re-read the tree/);
  });

  it("passes other backend refusals through verbatim", async () => {
    session.actResponse = { success: false, error: "not-clickable" };
    const client = await connect(session);
    const res = await client.callTool({
      name: "click_element",
      arguments: { role: "button", name: "Go" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe("not-clickable");
  });

  it("type_text forwards the value as payload and NEVER echoes it (R1)", async () => {
    const client = await connect(session);
    const res = await client.callTool({
      name: "type_text",
      arguments: { role: "textbox", name: "Email", text: "hunter2-SECRET" },
    });
    const act = session.calls.find((c) => c.fn === "act");
    expect(act?.args[0]).toEqual({
      nodeId: "ax-dom-13",
      action: "type",
      payload: { value: "hunter2-SECRET" },
    });
    expect(textOf(res)).toMatch(/Typed into textbox "Email"/);
    expect(textOf(res)).not.toContain("hunter2");
  });

  it("type_text keeps the value out of failure results too (R1)", async () => {
    session.actResponse = { success: false, error: "not-a-text-field" };
    const client = await connect(session);
    const res = await client.callTool({
      name: "type_text",
      arguments: { role: "textbox", name: "Email", text: "hunter2-SECRET" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).not.toContain("hunter2");
  });

  it("focus_element surfaces the follow-with-type_text hint for text fields", async () => {
    session.actResponse = {
      success: true,
      requiresInput: true,
      inputType: "email",
    };
    const client = await connect(session);
    const res = await client.callTool({
      name: "focus_element",
      arguments: { role: "textbox", name: "Email" },
    });
    const out = textOf(res);
    expect(out).toMatch(/Focused textbox "Email"/);
    expect(out).toMatch(/text field \(email\)/);
    expect(out).toMatch(/type_text/);
  });

  it("steers to checkpoint_tree when no tree checkpoint exists, to diff_tree when one does", async () => {
    session.responses.checkpointTree = "Tree checkpoint captured — 6 node(s).";
    const client = await connect(session);

    const before = await client.callTool({
      name: "click_element",
      arguments: { role: "button", name: "Go" },
    });
    expect(textOf(before)).toMatch(/checkpoint_tree before acting/);

    await client.callTool({
      name: "checkpoint_tree",
      arguments: { rootSelector: "body" },
    });
    const after = await client.callTool({
      name: "click_element",
      arguments: { role: "button", name: "Go" },
    });
    expect(textOf(after)).toMatch(/Call diff_tree to see what this changed/);
  });

  it("rejects a missing text and a zero nth at the schema", async () => {
    const client = await connect(session);
    const noText = await client.callTool({
      name: "type_text",
      arguments: { role: "textbox", name: "Email" },
    });
    expect(noText.isError).toBe(true);
    expect(textOf(noText)).toMatch(/Input validation error/);

    const zeroNth = await client.callTool({
      name: "click_element",
      arguments: { role: "button", name: "Go", nth: 0 },
    });
    expect(zeroNth.isError).toBe(true);
    expect(textOf(zeroNth)).toMatch(/Input validation error/);
    // Neither invalid call reached the session at all.
    expect(session.calls).toHaveLength(0);
  });

  it("carries the load-bearing caveats in the descriptions", async () => {
    const client = await connect(session);
    const tools = (await client.listTools()).tools;
    const byName = (n: string) => tools.find((t) => t.name === n)!;

    // type_text must never read as a login path.
    const type = byName("type_text");
    expect(type.description).toMatch(/NO credential parameter/);
    expect(type.description).toMatch(/REAL_A11Y_MCP_STORAGE_STATE/);
    expect(type.description).toMatch(/NEVER echoes the typed text/);

    // click_element names the loop and the navigation hazard.
    const click = byName("click_element");
    expect(click.description).toMatch(/checkpoint_tree/);
    expect(click.description).toMatch(/diff_tree/);
    expect(click.description).toMatch(/NAVIGATE/);
    expect(click.annotations?.idempotentHint).toBe(false);
    expect(click.annotations?.openWorldHint).toBe(true);

    // A repeated type replaces the same value — honestly idempotent.
    expect(type.annotations?.idempotentHint).toBe(true);
    expect(byName("focus_element").annotations?.readOnlyHint).toBe(false);
  });
});

describe("named sessions", () => {
  /** A manager whose factory hands out one FakeSession per name, recorded. */
  function makeManager(
    options: { maxSessions?: number; idleTimeoutMs?: number } = {},
  ) {
    const created: FakeSession[] = [];
    const manager = new McpSessionManager({
      createSession: () => {
        const s = new FakeSession();
        created.push(s);
        return s;
      },
      maxSessions: options.maxSessions,
      idleTimeoutMs: options.idleTimeoutMs,
    });
    return { manager, created };
  }

  async function connectManager(manager: McpSessionManager) {
    const server = buildServer(manager);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    return client;
  }

  it("creates one browser session per name, lazily, and routes calls to it", async () => {
    const { manager, created } = makeManager();
    const client = await connectManager(manager);
    expect(created.length).toBe(0);

    await client.callTool({
      name: "open_page",
      arguments: { url: "https://a.example/", session: "alpha" },
    });
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://b.example/", session: "beta" },
    });
    expect(created.length).toBe(2);
    expect(created[0].opened.map((o) => o.url)).toEqual(["https://a.example/"]);
    expect(created[1].opened.map((o) => o.url)).toEqual(["https://b.example/"]);

    // Same name → same session, no new launch.
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://a2.example/", session: "alpha" },
    });
    expect(created.length).toBe(2);
    expect(created[0].opened.map((o) => o.url)).toEqual([
      "https://a.example/",
      "https://a2.example/",
    ]);
  });

  it("keeps checkpoints isolated between sessions", async () => {
    const { manager } = makeManager();
    const client = await connectManager(manager);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://a.example/", session: "alpha" },
    });
    await client.callTool({
      name: "checkpoint_findings",
      arguments: { name: "base", session: "alpha" },
    });

    const inAlpha = await client.callTool({
      name: "list_checkpoints",
      arguments: { session: "alpha" },
    });
    expect(textOf(inAlpha as never)).toMatch(/1 checkpoint/);

    // The same label does not exist in a different session.
    const inBeta = await client.callTool({
      name: "list_checkpoints",
      arguments: { session: "beta" },
    });
    expect(textOf(inBeta as never)).toMatch(/No checkpoints saved/);
  });

  it("close_browser closes one named session; all=true closes every one", async () => {
    const { manager, created } = makeManager();
    const client = await connectManager(manager);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://a.example/", session: "alpha" },
    });
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://b.example/", session: "beta" },
    });

    const one = await client.callTool({
      name: "close_browser",
      arguments: { session: "alpha" },
    });
    expect(textOf(one as never)).toMatch(/"alpha" closed/);
    expect(created[0].closed).toBe(1);
    expect(created[1].closed).toBe(0);

    const rest = await client.callTool({
      name: "close_browser",
      arguments: { all: true },
    });
    expect(textOf(rest as never)).toMatch(/Closed 1 session/);
    expect(created[1].closed).toBe(1);
  });

  it("list_sessions reports live sessions and empty state", async () => {
    const { manager } = makeManager();
    const client = await connectManager(manager);

    const empty = await client.callTool({
      name: "list_sessions",
      arguments: {},
    });
    expect(textOf(empty as never)).toMatch(/No sessions/);

    await client.callTool({
      name: "open_page",
      arguments: { url: "https://a.example/", session: "alpha" },
    });
    const listed = await client.callTool({
      name: "list_sessions",
      arguments: {},
    });
    expect(textOf(listed as never)).toMatch(/1 session\(s\):/);
    expect(textOf(listed as never)).toMatch(/alpha/);
  });

  it("refuses a session beyond the cap, naming the remedy", async () => {
    const { manager, created } = makeManager({ maxSessions: 1 });
    const client = await connectManager(manager);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://a.example/", session: "alpha" },
    });
    const refused = await client.callTool({
      name: "open_page",
      arguments: { url: "https://b.example/", session: "beta" },
    });
    expect(textOf(refused as never)).toMatch(/session limit reached/);
    expect(textOf(refused as never)).toMatch(/close_browser/);
    expect(created.length).toBe(1);

    // The existing session is unaffected and still usable.
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://a2.example/", session: "alpha" },
    });
    expect(created[0].opened.length).toBe(2);
  });

  it("rejects an invalid session name as a TOOL error carrying the grammar", async () => {
    const { manager, created } = makeManager();
    const client = await connectManager(manager);
    // Not a schema regex: that would reject in the SDK's pre-handler parse and
    // reach the agent as a raw zod issue array (a protocol InvalidParams), with
    // the actionable hint nowhere in sight. The manager is the gate.
    const res = await client.callTool({
      name: "open_page",
      arguments: { url: "https://a.example/", session: "not ok!" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res as never)).toMatch(/invalid session name "not ok!"/);
    expect(textOf(res as never)).toMatch(/1-32 characters/);
    expect(created.length).toBe(0);

    // Checkpoint-only tools go through a different path — same treatment.
    const cp = await client.callTool({
      name: "list_checkpoints",
      arguments: { session: "nope!" },
    });
    expect(cp.isError).toBe(true);
    expect(textOf(cp as never)).toMatch(/invalid session name/);
  });

  it("holds the cap when new sessions are requested concurrently", async () => {
    // The check must not read a map that in-flight creations haven't reached
    // yet: four parallel calls with four new names would all see "0 live".
    const { manager, created } = makeManager({ maxSessions: 2 });
    const client = await connectManager(manager);
    const results = await Promise.all(
      ["a", "b", "c", "d"].map((name) =>
        client.callTool({
          name: "open_page",
          arguments: { url: `https://${name}.example/`, session: name },
        }),
      ),
    );
    const refused = results.filter((r) => r.isError);
    expect(created.length).toBe(2);
    expect(refused.length).toBe(2);
    expect(textOf(refused[0] as never)).toMatch(/session limit reached \(2/);
  });

  it("does not spend a session slot on checkpoint-only tools", async () => {
    // list/diff/export/import never touch the page. A typo'd session there
    // must not reserve a slot (or launch anything) — the cap exists to catch
    // typos, not to be exhausted by them.
    const { manager, created } = makeManager({ maxSessions: 1 });
    const client = await connectManager(manager);
    for (const session of ["typo1", "typo2", "typo3"]) {
      const res = await client.callTool({
        name: "list_checkpoints",
        arguments: { session },
      });
      expect(textOf(res as never)).toMatch(/No checkpoints saved/);
    }
    expect(created.length).toBe(0);
    expect(manager.list()).toHaveLength(0);

    // The one real session is still available.
    const ok = await client.callTool({
      name: "open_page",
      arguments: { url: "https://a.example/", session: "alpha" },
    });
    expect(ok.isError).toBeFalsy();
    expect(created.length).toBe(1);
  });

  it("keeps findings checkpoints when the idle timeout closes the browser", async () => {
    // The idle timeout closes the browser and the next call relaunches it.
    // Baselines saved for a later diff must NOT go with it: an agent that
    // saved 'prod', waited, then diffed would silently re-baseline against the
    // new page and report zero regressions.
    const { manager, created } = makeManager({ idleTimeoutMs: 40 });
    const client = await connectManager(manager);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://a.example/", session: "alpha" },
    });
    await client.callTool({
      name: "checkpoint_findings",
      arguments: { name: "prod", session: "alpha" },
    });

    // Real timer, real path: SessionRegistry.fireIdleTimeout → registry
    // stopAll, which cannot reach the manager's checkpoint stores.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(created[0].closed).toBe(1);
    expect(manager.list()).toHaveLength(0);

    const listed = await client.callTool({
      name: "list_checkpoints",
      arguments: { session: "alpha" },
    });
    expect(textOf(listed as never)).toMatch(/1 checkpoint/);
    expect(textOf(listed as never)).toMatch(/prod/);

    // close_browser remains the documented way to discard them.
    const closed = await client.callTool({
      name: "close_browser",
      arguments: { session: "alpha" },
    });
    expect(textOf(closed as never)).toMatch(
      /1 stored checkpoint\(s\) discarded/,
    );
    const after = await client.callTool({
      name: "list_checkpoints",
      arguments: { session: "alpha" },
    });
    expect(textOf(after as never)).toMatch(/No checkpoints saved/);
  });

  it("refuses close_browser with both a session and all=true", async () => {
    const { manager, created } = makeManager();
    const client = await connectManager(manager);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://a.example/", session: "alpha" },
    });
    const res = await client.callTool({
      name: "close_browser",
      arguments: { session: "alpha", all: true },
    });
    // A destructive tool must never quietly do MORE than it was asked.
    expect(res.isError).toBe(true);
    expect(textOf(res as never)).toMatch(/not both/);
    expect(created[0].closed).toBe(0);
  });

  it("rejects unknown arguments to list_sessions instead of ignoring them", async () => {
    const { manager } = makeManager();
    const client = await connectManager(manager);
    const tool = (await client.listTools()).tools.find(
      (t) => t.name === "list_sessions",
    );
    expect(tool?.inputSchema.additionalProperties).toBe(false);
    // An agent will reach for list_sessions({session}) expecting a filter. A
    // rejected extra property beats one that is silently ignored.
    const res = await client.callTool({
      name: "list_sessions",
      arguments: { session: "a" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res as never)).toMatch(/Unrecognized key|unrecognized_keys/);
  });

  it("survives its methods being detached from the manager", async () => {
    // `SessionManager` is shaped like a callback bag and gets used like one:
    // `process.on("SIGTERM", manager.shutdown)`.
    const { manager, created } = makeManager();
    const { run, list, stop, stopAll, checkpoints, shutdown } = manager;
    await run("alpha", async (rec) => {
      await rec.session.open("https://a.example/");
      return 0;
    });
    expect(list()).toHaveLength(1);
    expect(checkpoints("alpha").size).toBe(0);
    expect(await stop("alpha")).toBe(true);
    await stopAll();
    await shutdown();
    expect(created[0].closed).toBeGreaterThan(0);
  });

  it("shutdown() releases the registry for good", async () => {
    const { manager, created } = makeManager();
    await manager.run("alpha", async () => 0);
    await manager.shutdown();
    expect(created[0].closed).toBe(1);
    await expect(manager.run("alpha", async () => 0)).rejects.toThrow(
      /shut down/,
    );
  });
});

describe("single-session embedder path (buildServer(session))", () => {
  let session: FakeSession;
  beforeEach(() => {
    session = new FakeSession();
  });

  it("refuses a named session instead of silently sharing one page", async () => {
    // The old adapter ignored `name`: every name resolved to the same page and
    // the same checkpoint store, while the descriptions promised isolation —
    // so a two-deploy diff compared a page against a baseline of itself.
    const client = await connect(session);
    const res = await client.callTool({
      name: "open_page",
      arguments: { url: "https://a.example/", session: "preview" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res as never)).toMatch(/single browser session/);
    expect(textOf(res as never)).toMatch(/omit the session parameter/);
    expect(session.opened).toHaveLength(0);
  });

  it("says it is single-session in the instructions and the parameter", async () => {
    const client = await connect(session);
    const tool = (await client.listTools()).tools.find(
      (t) => t.name === "open_page",
    );
    const sessionProp = (
      tool?.inputSchema.properties as
        Record<string, { description?: string }> | undefined
    )?.session;
    expect(sessionProp?.description).toMatch(/single browser session/);
    expect(sessionProp?.description).not.toMatch(/run in parallel/);
    expect(client.getInstructions()).toMatch(/SINGLE browser session/);
  });

  it("redacts the URL in list_sessions, like the registry path", async () => {
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://user:pw@app.example/x?access_token=SECRET" },
    });
    const res = await client.callTool({ name: "list_sessions", arguments: {} });
    const out = textOf(res as never);
    expect(out).not.toContain("SECRET");
    expect(out).not.toContain("pw@");
    expect(out).toContain("app.example");
  });

  it("reports no sessions until one is actually used", async () => {
    const client = await connect(session);
    const before = await client.callTool({
      name: "list_sessions",
      arguments: {},
    });
    expect(textOf(before as never)).toMatch(/No sessions/);

    await client.callTool({
      name: "open_page",
      arguments: { url: "https://a.example/" },
    });
    const after = await client.callTool({
      name: "list_sessions",
      arguments: {},
    });
    expect(textOf(after as never)).toMatch(/1 session\(s\)/);

    await client.callTool({ name: "close_browser", arguments: {} });
    const closed = await client.callTool({
      name: "list_sessions",
      arguments: {},
    });
    expect(textOf(closed as never)).toMatch(/No sessions/);
  });

  it("never closes the embedder's browser for a name it does not have", async () => {
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://a.example/" },
    });
    const res = await client.callTool({
      name: "close_browser",
      arguments: { session: "typo" },
    });
    // The old adapter closed the one real browser and replied `"typo" closed.`
    expect(res.isError).toBe(true);
    expect(textOf(res as never)).toMatch(/single browser session/);
    expect(session.closed).toBe(0);
  });

  it("closes nothing on all=true when nothing was ever opened", async () => {
    const client = await connect(session);
    const res = await client.callTool({
      name: "close_browser",
      arguments: { all: true },
    });
    expect(textOf(res as never)).toMatch(/No sessions were open/);
    expect(session.closed).toBe(0);
  });

  it("refuses a bad argument to buildServer by name", async () => {
    // `"act" in sessionOrManager` threw "Cannot use 'in' operator" here, with
    // no clue which argument was wrong.
    expect(() => buildServer(null as unknown as A11ySession)).toThrow(
      /buildServer requires an A11ySession or a SessionManager, got null/,
    );
    expect(() => buildServer(undefined as unknown as A11ySession)).toThrow(
      /got undefined/,
    );
  });

  it("classifies a session-like Proxy as a session, not a manager", async () => {
    // A Proxy without a `has` trap answered `"act" in x` unpredictably; the
    // check is now a positive test of the manager's own methods.
    const proxied = new Proxy(session, {}) as A11ySession;
    const client = await connect(proxied);
    const res = await client.callTool({
      name: "open_page",
      arguments: { url: "https://a.example/" },
    });
    expect(res.isError).toBeFalsy();
    expect(session.opened).toHaveLength(1);
  });
});
