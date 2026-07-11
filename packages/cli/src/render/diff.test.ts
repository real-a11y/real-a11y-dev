import type { Finding } from "@real-a11y-dev/testing";
import { describe, expect, it } from "vitest";

import { diffArtifacts } from "../diff/page-diff.js";
import { fingerprintFindings } from "../fingerprint.js";
import { buildArtifact, type SnapshotPage } from "../snapshot-artifact.js";

import {
  renderDiffJson,
  renderDiffMarkdown,
  renderDiffPretty,
} from "./diff.js";

const button: Finding = {
  rule: "no-unlabeled-interactive",
  severity: "error",
  message: "Unlabeled interactive element: button <button>",
  role: "button",
  tagName: "button",
  locator: "#save",
  context: "in <main>",
};

function page(name: string, findings: Finding[]): SnapshotPage {
  return {
    name,
    url: `http://x/${name}`,
    root: "body",
    status: "ok",
    findings: fingerprintFindings(name, findings),
    tree: "main",
    outline: "",
    tabs: "",
  };
}

// Base clean, PR has one new finding.
const result = diffArtifacts(
  buildArtifact([page("Home", [])], { toolName: "cli", toolVersion: "0" }),
  buildArtifact([page("Home", [button])], {
    toolName: "cli",
    toolVersion: "0",
  }),
);

describe("renderDiffPretty", () => {
  it("shows NEW findings and puts the summary on the last line", () => {
    const out = renderDiffPretty(result, { color: false });
    expect(out).toContain("+ new [error] no-unlabeled-interactive");
    expect(out).toContain("#save");
    expect(out.trimEnd().split("\n").at(-1)).toBe(
      "1 new · 0 changed · 0 fixed",
    );
  });

  it("never conveys via color alone (text tags present with color on)", () => {
    const out = renderDiffPretty(result, { color: true });
    expect(out).toContain("+ new [error]");
  });
});

describe("renderDiffJson", () => {
  it("emits a stable envelope with new/changed/removed per page", () => {
    const parsed = JSON.parse(renderDiffJson(result)) as {
      schemaVersion: number;
      command: string;
      summary: { new: number };
      pages: { name: string; new: unknown[]; views: unknown }[];
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.command).toBe("diff");
    expect(parsed.summary.new).toBe(1);
    expect(parsed.pages[0].new).toHaveLength(1);
  });
});

describe("renderDiffMarkdown", () => {
  it("renders a PR-comment-ready summary", () => {
    const out = renderDiffMarkdown(result);
    expect(out).toMatch(/### Accessibility diff — 1 new/);
    expect(out).toMatch(/\*\*new\*\* `no-unlabeled-interactive`/);
  });

  it("says so when nothing changed", () => {
    const clean = diffArtifacts(
      buildArtifact([page("Home", [])], { toolName: "c", toolVersion: "0" }),
      buildArtifact([page("Home", [])], { toolName: "c", toolVersion: "0" }),
    );
    expect(renderDiffMarkdown(clean)).toContain(
      "No accessibility finding changes.",
    );
  });
});
