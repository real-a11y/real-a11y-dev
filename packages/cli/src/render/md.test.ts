import type { Finding } from "@real-a11y-dev/audit";

import {
  buildArtifact,
  fingerprintFindings,
  type SnapshotPage,
} from "@real-a11y-dev/snapshot";
import { describe, expect, it } from "vitest";

import { renderSnapshotMarkdown } from "./md.js";

const button: Finding = {
  rule: "no-unlabeled-interactive",
  severity: "error",
  message: "Unlabeled interactive element: button <button>",
  locator: "#save",
};

function page(name: string, findings: Finding[]): SnapshotPage {
  return {
    name,
    url: `http://x/${name}`,
    root: "body",
    status: "ok",
    findings: fingerprintFindings(name, findings),
    tree: 'main\n  button "Save"',
    outline: "h1 Home",
    tabs: '01. button "Save"',
  };
}

const artifact = buildArtifact([page("Home", [button])], {
  toolName: "cli",
  toolVersion: "0",
});

describe("renderSnapshotMarkdown", () => {
  it("renders findings and all three views by default", () => {
    const out = renderSnapshotMarkdown(artifact);
    expect(out).toContain("1 issue(s) — 1 error(s), 0 warning(s)");
    expect(out).toContain("- [error] `no-unlabeled-interactive`");
    expect(out).toContain("### Semantic tree");
    expect(out).toContain("### Heading outline");
    expect(out).toContain("### Tab order");
  });

  it("--findings-only drops the view sections, keeps the findings", () => {
    const out = renderSnapshotMarkdown(artifact, "findings");
    expect(out).toContain("- [error] `no-unlabeled-interactive`");
    expect(out).not.toContain("### Semantic tree");
    expect(out).not.toContain("### Heading outline");
    expect(out).not.toContain("### Tab order");
  });

  it("--only views is a pure structure export — no finding bullets, no issue count", () => {
    const out = renderSnapshotMarkdown(artifact, "views");
    expect(out).not.toContain("issue(s)");
    expect(out).not.toContain("- [error]");
    expect(out).toContain("### Semantic tree");
    expect(out).toContain('button "Save"');
    // (A --fail-on exit is explained on stderr by the snapshot command.)
  });

  it("errored pages render their failure note under either filter", () => {
    const broken = buildArtifact(
      [{ ...page("Home", []), status: "error", error: "boom" }],
      { toolName: "cli", toolVersion: "0" },
    );
    for (const only of ["findings", "views"] as const) {
      expect(renderSnapshotMarkdown(broken, only)).toContain(
        "> Snapshot failed: boom",
      );
    }
  });
});
