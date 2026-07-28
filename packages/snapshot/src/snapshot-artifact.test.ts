import { describe, expect, it } from "vitest";

import { SnapshotFormatError } from "./errors.js";
import { fingerprintFindings } from "./fingerprint.js";
import {
  ARTIFACT_SCHEMA_VERSION,
  assertFullArtifact,
  buildArtifact,
  measuredViews,
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
      expect(err).toBeInstanceOf(SnapshotFormatError);
      expect((err as SnapshotFormatError).message).toContain(
        "schemaVersion 999",
      );
      expect((err as SnapshotFormatError).hint).toContain("real-a11y snapshot");
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

describe("partial artifacts (--only)", () => {
  const meta = { toolName: "@real-a11y-dev/cli", toolVersion: "0.0.1" };

  it("buildArtifact records meta.only, defaulting to null (= full)", () => {
    expect(buildArtifact([page()], meta).meta.only).toBeNull();
    expect(buildArtifact([page()], { ...meta, only: "views" }).meta.only).toBe(
      "views",
    );
  });

  it("meta.only survives the serialize/parse round-trip", () => {
    const partial = buildArtifact([page({ findings: [] })], {
      ...meta,
      only: "views",
    });
    const parsed = parseSnapshotArtifact(serializeArtifact(partial));
    expect(parsed.meta.only).toBe("views");
  });

  it("assertFullArtifact passes a full artifact and rejects both partial axes", () => {
    expect(() =>
      assertFullArtifact(buildArtifact([page()], meta)),
    ).not.toThrow();
    for (const only of ["findings", "views"] as const) {
      try {
        assertFullArtifact(buildArtifact([page()], { ...meta, only }), "base");
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(SnapshotFormatError);
        expect((err as SnapshotFormatError).message).toContain(
          `--only ${only}`,
        );
        expect((err as SnapshotFormatError).hint).toContain("without --only");
      }
    }
  });

  it("assertFullArtifact tolerates a hand-made artifact without meta", () => {
    const bare = parseSnapshotArtifact(
      JSON.stringify({ schemaVersion: 1, pages: [{ name: "Home" }] }),
    );
    expect(() => assertFullArtifact(bare)).not.toThrow();
  });
});

describe("meta.views — which views the run measured", () => {
  const meta = { toolName: "@real-a11y-dev/cli", toolVersion: "0.0.1" };

  it("defaults to all three, so an artifact that says nothing means the old world", () => {
    expect(buildArtifact([page()], meta).meta.views).toEqual([
      "tree",
      "outline",
      "tabs",
    ]);
  });

  it("records a narrower set and survives the round-trip", () => {
    const native = buildArtifact([page({ tabs: undefined })], {
      ...meta,
      views: ["tree", "outline"],
    });
    const parsed = parseSnapshotArtifact(serializeArtifact(native));
    expect(parsed.meta.views).toEqual(["tree", "outline"]);
  });

  it('keeps an unmeasured view ABSENT rather than defaulting it to ""', () => {
    // The whole point. The reader used to coerce a missing `tabs` to "", which
    // is indistinguishable from "measured, nothing focusable" — so omitting the
    // view on the producer side was a no-op and the diff still read N → 0.
    const json = JSON.stringify({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      tool: { name: "cli", version: "0" },
      meta: {
        rules: null,
        device: null,
        viewport: null,
        only: null,
        views: ["tree", "outline"],
      },
      pages: [
        { name: "Home", status: "ok", findings: [], tree: "main", outline: "" },
      ],
    });
    expect(parseSnapshotArtifact(json).pages[0].tabs).toBeUndefined();
  });

  it('still defaults a MEASURED-but-missing view to ""', () => {
    // "We measured tab order and found nothing focusable" is a real state, and
    // it must keep reading as one.
    const json = JSON.stringify({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      tool: { name: "cli", version: "0" },
      meta: { rules: null, device: null, viewport: null, only: null },
      pages: [
        { name: "Home", status: "ok", findings: [], tree: "main", outline: "" },
      ],
    });
    expect(parseSnapshotArtifact(json).pages[0].tabs).toBe("");
  });

  it("drops a stray view the artifact says it never measured", () => {
    // One source of truth: if the run declares it didn't measure tab order, a
    // leftover `tabs` string is meaningless and must not reach the differ.
    const json = JSON.stringify({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      tool: { name: "cli", version: "0" },
      meta: {
        rules: null,
        device: null,
        viewport: null,
        only: null,
        views: ["tree", "outline"],
      },
      pages: [
        {
          name: "Home",
          status: "ok",
          findings: [],
          tree: "main",
          outline: "",
          tabs: 'link "Home"',
        },
      ],
    });
    expect(parseSnapshotArtifact(json).pages[0].tabs).toBeUndefined();
  });

  it("measuredViews reads a legacy artifact as having measured everything", () => {
    const legacy = parseSnapshotArtifact(
      JSON.stringify({
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        pages: [{ name: "Home" }],
      }),
    );
    expect([...measuredViews(legacy)].sort()).toEqual([
      "outline",
      "tabs",
      "tree",
    ]);
  });
});
