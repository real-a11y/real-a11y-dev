import { describe, expect, it } from "vitest";

import { CliError } from "./exit.js";
import { fingerprintFindings } from "./fingerprint.js";
import {
  ARTIFACT_SCHEMA_VERSION,
  buildArtifact,
  parseSnapshotArtifact,
  serializeArtifact,
  type SnapshotPage,
} from "./snapshot-artifact.js";

const page = (over: Partial<SnapshotPage> = {}): SnapshotPage => ({
  name: "Home",
  url: "http://localhost:3000/",
  root: "body",
  status: "ok",
  findings: fingerprintFindings("Home", [
    {
      rule: "image-alt",
      severity: "warning",
      message: "Image has no accessible name",
      role: "img",
      tagName: "img",
      locator: "#hero",
    },
  ]),
  tree: "main",
  outline: "h1 Home",
  tabs: "01. link",
  ...over,
});

describe("build + parse round-trip", () => {
  it("serializes and parses back to the same artifact", () => {
    const artifact = buildArtifact([page()], {
      toolName: "@real-a11y-dev/cli",
      toolVersion: "0.0.1",
      rules: ["image-alt"],
    });
    expect(artifact.schemaVersion).toBe(ARTIFACT_SCHEMA_VERSION);
    const parsed = parseSnapshotArtifact(serializeArtifact(artifact));
    expect(parsed.pages[0].name).toBe("Home");
    expect(parsed.pages[0].findings[0].fingerprint).toMatch(/^v1:/);
  });
});

describe("parseSnapshotArtifact", () => {
  it("rejects a schema-version mismatch with a re-snapshot hint", () => {
    const json = JSON.stringify({ schemaVersion: 999, pages: [] });
    try {
      parseSnapshotArtifact(json);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).message).toContain("schemaVersion 999");
      expect((err as CliError).hint).toContain("real-a11y snapshot");
    }
  });

  it("rejects non-JSON and shapeless input", () => {
    expect(() => parseSnapshotArtifact("not json")).toThrow(/not valid JSON/);
    expect(() =>
      parseSnapshotArtifact(JSON.stringify({ schemaVersion: 1 })),
    ).toThrow(/no "pages" array/);
    expect(() =>
      parseSnapshotArtifact(
        JSON.stringify({ schemaVersion: 1, pages: [{ url: "x" }] }),
      ),
    ).toThrow(/without a "name"/);
  });

  it("ignores unknown fields and defaults missing view strings", () => {
    const parsed = parseSnapshotArtifact(
      JSON.stringify({
        schemaVersion: 1,
        futureField: 42,
        pages: [{ name: "Home", extra: true }],
      }),
    );
    expect(parsed.pages[0].tree).toBe("");
    expect(parsed.pages[0].findings).toEqual([]);
    expect(parsed.pages[0].status).toBe("ok");
  });
});
