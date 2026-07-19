import { resolve } from "node:path";

import type { Finding } from "@real-a11y-dev/audit";
import { describe, expect, it } from "vitest";

import { fingerprintFindings } from "../fingerprint.js";
import { buildArtifact, type SnapshotPage } from "../snapshot-artifact.js";

import { renderJsonl } from "./jsonl.js";
import { renderJUnit } from "./junit.js";
import { renderSarif } from "./sarif.js";

const finding = (over: Partial<Finding> = {}): Finding =>
  ({
    rule: "no-unlabeled-interactive",
    severity: "error",
    message: 'Unlabeled interactive element: button <button> with "<quotes>"',
    role: "button",
    tagName: "button",
    locator: "#nav > button",
    context: "",
    ...over,
  }) as Finding;

function page(
  name: string,
  findings: Finding[],
  over: Partial<SnapshotPage> = {},
): SnapshotPage {
  return {
    name,
    url: `http://localhost/${name}`,
    root: "body",
    status: "ok",
    findings: fingerprintFindings(name, findings),
    tree: "",
    outline: "",
    tabs: "",
    ...over,
  };
}

const meta = { toolName: "@real-a11y-dev/cli", toolVersion: "1.2.3" };

describe("renderSarif", () => {
  // Real, platform-absolute paths so `relative()` shortens them on Windows AND
  // Linux (a hardcoded "C:/repo" isn't absolute on POSIX).
  const rootDir = resolve("repo-fixture");
  const ctx = { configPath: resolve(rootDir, "a11y.config.json"), rootDir };

  it("emits a valid 2.1.0 skeleton with per-rule metadata", () => {
    const artifact = buildArtifact([page("Home", [finding()])], meta);
    const sarif = JSON.parse(renderSarif(artifact, ctx));
    expect(sarif.version).toBe("2.1.0");
    const driver = sarif.runs[0].tool.driver;
    expect(driver.name).toBe("real-a11y");
    expect(driver.version).toBe("1.2.3");
    expect(driver.rules).toHaveLength(5);
    const rule = driver.rules.find(
      (r: { id: string }) => r.id === "no-unlabeled-interactive",
    );
    expect(rule.defaultConfiguration.level).toBe("error");
    const headings = driver.rules.find(
      (r: { id: string }) => r.id === "heading-order",
    );
    expect(headings.defaultConfiguration.level).toBe("warning");
  });

  it("anchors results to sourcePath, else the config file — never the URL", () => {
    const artifact = buildArtifact(
      [
        page("Home", [finding()], { sourcePath: "src/pages/home.tsx" }),
        page("Other", [finding()]),
      ],
      meta,
    );
    const sarif = JSON.parse(renderSarif(artifact, ctx));
    const uris = sarif.runs[0].results.map(
      (r: {
        locations: {
          physicalLocation: { artifactLocation: { uri: string } };
        }[];
      }) => r.locations[0].physicalLocation.artifactLocation.uri,
    );
    expect(uris).toEqual(["src/pages/home.tsx", "a11y.config.json"]);
    for (const uri of uris) expect(uri).not.toMatch(/^https?:/);
  });

  it("supplies the v1 fingerprint as primaryLocationLineHash", () => {
    const artifact = buildArtifact([page("Home", [finding()])], meta);
    const sarif = JSON.parse(renderSarif(artifact, ctx));
    const fp = sarif.runs[0].results[0].partialFingerprints;
    expect(fp.primaryLocationLineHash).toMatch(/^v1:[0-9a-f]{16}$/);
  });

  it("excludes baseline-suppressed findings", () => {
    const p = page("Home", [finding(), finding({ locator: "#x > button" })]);
    p.findings[0].suppressed = true;
    const artifact = buildArtifact([p], meta);
    const sarif = JSON.parse(renderSarif(artifact, ctx));
    expect(sarif.runs[0].results).toHaveLength(1);
  });

  it("scopes automationDetails to the config, and caps messages", () => {
    const long = finding({ message: "x".repeat(2000) });
    const artifact = buildArtifact([page("Home", [long])], meta);
    const sarif = JSON.parse(renderSarif(artifact, ctx));
    expect(sarif.runs[0].automationDetails.id).toBe("real-a11y/a11y.config");
    expect(sarif.runs[0].results[0].message.text.length).toBeLessThanOrEqual(
      1000,
    );
  });
});

describe("renderJUnit", () => {
  it("one suite per page; findings are failures; clean page passes", () => {
    const artifact = buildArtifact(
      [page("Bad", [finding()]), page("Clean", [])],
      meta,
    );
    const xml = renderJUnit(artifact);
    expect(xml).toContain('<testsuite name="Bad" tests="1" failures="1"');
    expect(xml).toContain('<testsuite name="Clean" tests="1" failures="0"');
    expect(xml).toContain('<testcase name="page audited" classname="Clean"/>');
  });

  it("escapes XML and marks suppressed findings as skipped", () => {
    const p = page("Home", [finding(), finding({ locator: "#x > button" })]);
    p.findings[1].suppressed = true;
    const artifact = buildArtifact([p], meta);
    const xml = renderJUnit(artifact);
    expect(xml).toContain("&lt;button&gt;");
    expect(xml).toContain("&quot;&lt;quotes&gt;&quot;");
    expect(xml).not.toContain('with "<quotes>"');
    expect(xml).toContain('skipped="1"');
    expect(xml).toContain("<skipped message=");
  });

  it("a failed page is an <error>", () => {
    const artifact = buildArtifact(
      [page("Down", [], { status: "error", error: "nav timeout" })],
      meta,
    );
    const xml = renderJUnit(artifact);
    expect(xml).toContain('errors="1"');
    expect(xml).toContain('<error message="nav timeout"/>');
  });
});

describe("renderJsonl", () => {
  it("one parseable JSON object per finding, no framing records", () => {
    const artifact = buildArtifact(
      [
        page("A", [finding(), finding({ locator: "#x > button" })]),
        page("B", []),
      ],
      meta,
    );
    const lines = renderJsonl(artifact).trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.page).toBe("A");
    expect(first.rule).toBe("no-unlabeled-interactive");
    expect(first.fingerprint).toMatch(/^v1:/);
    expect(first).not.toHaveProperty("suppressed");
  });

  it("flags suppressed findings and renders empty for no findings", () => {
    const p = page("A", [finding()]);
    p.findings[0].suppressed = true;
    expect(
      JSON.parse(renderJsonl(buildArtifact([p], meta)).trim()).suppressed,
    ).toBe(true);
    expect(renderJsonl(buildArtifact([page("B", [])], meta))).toBe("");
  });
});
