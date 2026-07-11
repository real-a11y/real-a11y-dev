import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ALL_RULES } from "@real-a11y-dev/testing";
import type { Finding } from "@real-a11y-dev/testing";
import { describe, it, expect, beforeEach } from "vitest";

import type {
  A11ySession,
  OpenOptions,
  PageSnapshot,
  SnapshotOptions,
} from "./browser.js";
import {
  buildServer,
  renderAudit,
  renderCompare,
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
    return { title: "Fake Title", url };
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

  async close() {
    this.closed += 1;
  }
}

/** Wire a Client to a server built around `session`, over an in-memory pair. */
async function connect(session: A11ySession, options?: BuildServerOptions) {
  const server = buildServer(session, options);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

function textOf(res: { content: { type: string; text?: string }[] }): string {
  return res.content.map((c) => c.text ?? "").join("");
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

  it("registers the audit-first tool surface", async () => {
    const client = await connect(session);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "audit_page",
        "close_browser",
        "compare_trees",
        "get_heading_outline",
        "get_native_tree",
        "get_semantic_tree",
        "get_tab_order",
        "inspect_page",
        "list_elements",
        "open_page",
      ].sort(),
    );
  });

  it("list_elements forwards the filter and rootSelector", async () => {
    session.responses.listByRole = 'link "Home"  [#home]\nlink "Docs"';
    const client = await connect(session);
    const res = await client.callTool({
      name: "list_elements",
      arguments: { filter: "link", rootSelector: "nav" },
    });
    const call = session.calls.find((c) => c.fn === "listByRole");
    expect(call?.rootSelector).toBe("nav");
    expect(call?.args).toEqual(["link"]);
    expect(textOf(res)).toContain('link "Home"');
  });

  it("compare_trees reports role/name divergences between custom and native", async () => {
    // Custom named an unlabeled input by its value; native (Chromium) did not.
    session.responses.auditSnapshot = 'main\n  textbox "john@example.com"';
    session.nativeResponse = {
      tree: "main\n  textbox",
      pairs: ["main", "textbox"],
    };
    const client = await connect(session);
    const res = await client.callTool({ name: "compare_trees", arguments: {} });
    const out = textOf(res);
    expect(out).toMatch(/CUSTOM tree/);
    expect(out).toContain('textbox "john@example.com"'); // only in custom
    expect(out).toMatch(/NATIVE tree/);
  });

  it("get_native_tree returns the browser's tree", async () => {
    session.nativeResponse = { tree: 'main\n  button "Go"', pairs: [] };
    const client = await connect(session);
    const res = await client.callTool({
      name: "get_native_tree",
      arguments: {},
    });
    expect(textOf(res)).toContain('button "Go"');
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

  it("audit_page forwards rules and defaults rootSelector to body", async () => {
    session.responses.collectFindings = [
      {
        rule: "heading-order",
        severity: "error",
        message: "Missing <h1>: ...",
      },
    ] satisfies Finding[];
    const client = await connect(session);
    const res = await client.callTool({
      name: "audit_page",
      arguments: { rules: ["heading-order"] },
    });

    const call = session.calls.find((c) => c.fn === "collectFindings");
    expect(call?.rootSelector).toBe("body");
    // rules array is passed as the first (and only) positional arg.
    expect(call?.args).toEqual([["heading-order"]]);
    expect(textOf(res)).toMatch(/heading-order/);
  });

  it("audit_page reports a clean page when no findings come back", async () => {
    session.responses.collectFindings = [] satisfies Finding[];
    const client = await connect(session);
    const res = await client.callTool({ name: "audit_page", arguments: {} });
    expect(textOf(res)).toMatch(/No accessibility issues found/);
  });

  it("audit_page omits the rules arg entirely when none are given", async () => {
    session.responses.collectFindings = [] satisfies Finding[];
    const client = await connect(session);
    await client.callTool({ name: "audit_page", arguments: {} });
    const call = session.calls.find((c) => c.fn === "collectFindings");
    // No positional args → collectFindings applies its own ALL_RULES default,
    // rather than being handed `[undefined]` (which would run zero rules).
    expect(call?.args).toEqual([]);
  });

  it("audit_page treats an empty rules array as 'run all rules'", async () => {
    session.responses.collectFindings = [] satisfies Finding[];
    const client = await connect(session);
    await client.callTool({ name: "audit_page", arguments: { rules: [] } });
    const call = session.calls.find((c) => c.fn === "collectFindings");
    expect(call?.args).toEqual([]);
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

  it("get_semantic_tree returns the tree and forwards includeGeneric", async () => {
    session.responses.auditSnapshot = 'main\n  button "Go"';
    const client = await connect(session);
    const res = await client.callTool({
      name: "get_semantic_tree",
      arguments: { includeGeneric: true },
    });
    const call = session.calls.find((c) => c.fn === "auditSnapshot");
    expect(call?.args).toEqual([{ includeGeneric: true }]);
    expect(textOf(res)).toContain('button "Go"');
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

  it("close_browser closes the session", async () => {
    const client = await connect(session);
    await client.callTool({ name: "close_browser", arguments: {} });
    expect(session.closed).toBe(1);
  });

  it("inspect_page returns all views from ONE snapshot call", async () => {
    session.snapshotResponse = {
      findings: [
        { rule: "heading-order", severity: "error", message: "Missing <h1>" },
      ],
      tree: 'main\n  button "Go"',
      outline: "(no headings)",
      tabOrder: '01. button "Go"',
    };
    const client = await connect(session);
    const res = await client.callTool({
      name: "inspect_page",
      arguments: { includeGeneric: true, rules: ["heading-order"] },
    });

    // Exactly one extraction: a single snapshot() call, and no separate
    // collectFindings/auditSnapshot/etc. calls behind it.
    const snapCalls = session.calls.filter((c) => c.fn === "snapshot");
    expect(snapCalls).toHaveLength(1);
    expect(snapCalls[0].rootSelector).toBe("body");
    expect(snapCalls[0].args).toEqual([
      { rules: ["heading-order"], includeGeneric: true },
    ]);

    // All four views are present in the one response.
    const out = textOf(res);
    expect(out).toMatch(/Single-extraction snapshot/);
    expect(out).toMatch(/heading-order/); // findings
    expect(out).toContain('button "Go"'); // tree + tab order
    expect(out).toMatch(/## Semantic tree/);
    expect(out).toMatch(/## Tab order/);
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

describe("renderCompare", () => {
  it("reports 'agree' when trees match (ignoring level suffix + indent)", () => {
    const custom = 'main\n  heading "Hi" (level 1)\n  button "Go"';
    const native = { tree: "", pairs: ["main", 'heading "Hi"', 'button "Go"'] };
    expect(renderCompare(custom, native)).toMatch(/agree/);
  });

  it("surfaces a name divergence (the .value-as-name bug)", () => {
    const custom = 'main\n  textbox "secret@x.com"';
    const native = { tree: "", pairs: ["main", "textbox"] };
    const out = renderCompare(custom, native);
    // custom-only `textbox "…"` + native-only bare `textbox` = 2 divergences.
    expect(out).toMatch(/2 divergence/);
    expect(out).toContain('textbox "secret@x.com"'); // custom-only
    expect(out.split("\n")).toContain("  textbox"); // native-only (empty name)
  });
});

describe("renderSnapshot", () => {
  it("counts tree nodes and tab stops and includes every section", () => {
    const out = renderSnapshot({
      findings: [],
      tree: "main\n  button\n  link",
      outline: "h1 Title",
      tabOrder: "01. button\n02. link",
    });
    expect(out).toMatch(/3 tree nodes/);
    expect(out).toMatch(/2 tab stops/);
    expect(out).toMatch(/No accessibility issues found/);
    expect(out).toContain("h1 Title");
  });
});
