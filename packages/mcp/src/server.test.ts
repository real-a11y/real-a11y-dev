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
  projectSnapshot,
} from "@real-a11y-dev/snapshot";
import { describe, it, expect, beforeEach } from "vitest";

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
        "diff_checkpoint",
        "diff_checkpoints",
        "export_checkpoint",
        "get_heading_outline",
        "get_native_tree",
        "get_semantic_tree",
        "get_tab_order",
        "import_checkpoint",
        "inspect_page",
        "list_checkpoints",
        "list_elements",
        "open_page",
        "save_checkpoint",
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

  it("compare_trees requests the custom tree WITHOUT the focus marker", async () => {
    session.responses.auditSnapshot = 'main\n  button "Go"';
    const client = await connect(session);
    await client.callTool({ name: "compare_trees", arguments: {} });
    const call = session.calls.find((c) => c.fn === "auditSnapshot");
    // The native tree carries no [focused] marker; a marker on the custom side
    // would register as a spurious custom-vs-native divergence.
    expect(call?.args).toEqual([{ markFocus: false }]);
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

describe("checkpoints", () => {
  let session: FakeSession;
  beforeEach(() => {
    session = new FakeSession();
  });

  const button = (locator: string): Finding => ({
    rule: "no-unlabeled-interactive",
    severity: "error",
    message: "Unlabeled interactive element: button <button>",
    role: "button",
    tagName: "BUTTON",
    locator,
  });
  const rawWith = (findings: Finding[]): PageSnapshot => ({
    findings,
    tree: "button",
    outline: "(no headings)",
    tabOrder: "1. button",
  });

  it("save_checkpoint then diff_checkpoint surfaces a NEW finding after a change", async () => {
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    session.snapshotResponse = rawWith([button("#save")]);
    const saved = textOf(
      await client.callTool({
        name: "save_checkpoint",
        arguments: { name: "before" },
      }),
    );
    expect(saved).toMatch(/"before" saved: 1 finding/);

    // A change introduces a second unlabeled button.
    session.snapshotResponse = rawWith([button("#save"), button("#cancel")]);
    const diff = textOf(
      await client.callTool({
        name: "diff_checkpoint",
        arguments: { name: "before" },
      }),
    );
    expect(diff).toMatch(/1 new/);
    expect(diff).toMatch(/NEW — gates CI/);
  });

  it("diff_checkpoint errors when the checkpoint is missing", async () => {
    const client = await connect(session);
    const res = await client.callTool({
      name: "diff_checkpoint",
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
    session.snapshotResponse = rawWith([button("#save")]);
    await client.callTool({
      name: "save_checkpoint",
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
    const raw = rawWith([button("#save"), button("#cancel")]);
    const url = "https://example.com/";
    const name = "home";

    // The CLI path (cli/commands/snapshot.ts): projectSnapshot, then assemble.
    const cliPage = buildSnapshotPage(name, url, projectSnapshot(raw), {
      root: "body",
    });

    // The MCP path: open → save → export, then parse the artifact back.
    session.snapshotResponse = raw;
    const client = await connect(session);
    await client.callTool({ name: "open_page", arguments: { url } });
    await client.callTool({ name: "save_checkpoint", arguments: { name } });
    const exported = textOf(
      await client.callTool({
        name: "export_checkpoint",
        arguments: { name },
      }),
    );
    const mcpPage = parseSnapshotArtifact(exported).pages[0];

    expect(mcpPage.findings.length).toBe(2);
    expect(mcpPage.findings.map((f) => f.fingerprint)).toEqual(
      cliPage.findings.map((f) => f.fingerprint),
    );
  });

  it("diff_checkpoint re-snapshots with the rules the checkpoint was saved with", async () => {
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    session.snapshotResponse = rawWith([]);
    await client.callTool({
      name: "save_checkpoint",
      arguments: { name: "hp", rules: ["heading-order"] },
    });
    await client.callTool({
      name: "diff_checkpoint",
      arguments: { name: "hp" },
    });
    // The diff's re-snapshot must carry the same rule subset, not all rules —
    // otherwise the omitted rules would surface as spurious NEW.
    const snaps = session.calls.filter((c) => c.fn === "snapshot");
    expect(snaps.at(-1)?.args[0]).toEqual({ rules: ["heading-order"] });
  });

  it("export_checkpoint round-trips as valid JSON for a normal page", async () => {
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    session.snapshotResponse = rawWith([button("#save")]);
    await client.callTool({
      name: "save_checkpoint",
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
    session.snapshotResponse = {
      findings: [],
      tree: "x".repeat(45_000),
      outline: "",
      tabOrder: "",
    };
    await client.callTool({
      name: "save_checkpoint",
      arguments: { name: "big" },
    });
    const res = await client.callTool({
      name: "export_checkpoint",
      arguments: { name: "big" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/too large to export inline/);
  });

  it("import under a new label then diff_checkpoint of an unchanged page reports no change", async () => {
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    session.snapshotResponse = rawWith([button("#save")]);
    // Save as "home" and export — the artifact's page name is "home".
    await client.callTool({
      name: "save_checkpoint",
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
        name: "diff_checkpoint",
        arguments: { name: "baseline" },
      }),
    );
    expect(diff).toMatch(/0 new, 0 fixed/);
  });

  it("diff_checkpoint re-snapshots with the root the checkpoint was saved with", async () => {
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    session.snapshotResponse = rawWith([]);
    await client.callTool({
      name: "save_checkpoint",
      arguments: { name: "modal", rootSelector: "[role=dialog]" },
    });
    // No rootSelector on the diff — it must fall back to the checkpoint's root,
    // not re-audit the whole "body" and surface the rest of the page as NEW.
    await client.callTool({
      name: "diff_checkpoint",
      arguments: { name: "modal" },
    });
    const snaps = session.calls.filter((c) => c.fn === "snapshot");
    expect(snaps.at(-1)?.rootSelector).toBe("[role=dialog]");
  });

  it("import_checkpoint rejects a partial (--only) artifact", async () => {
    const client = await connect(session);
    await client.callTool({
      name: "open_page",
      arguments: { url: "https://example.com/" },
    });
    session.snapshotResponse = rawWith([button("#save")]);
    await client.callTool({
      name: "save_checkpoint",
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
