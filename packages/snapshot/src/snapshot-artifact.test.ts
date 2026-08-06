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
  id: "/",
  name: "Home",
  url: "http://localhost:3000/",
  root: "body",
  status: "ok",
  findings: fingerprintFindings("/", [
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

  it("converts a version-1 artifact instead of refusing it", () => {
    // A v1 artifact's hashes were keyed on the display LABEL. Read as-is they'd
    // be compared against id-keyed ones and every unchanged finding would read
    // as fixed + new. Refusing would be the safe answer, but an artifact holds
    // both the url (→ identity) and each finding's components (→ everything
    // else in the tuple), so it can be re-keyed exactly. Only a baseline, which
    // stores no url, genuinely has to be refused.
    const raw = {
      rule: "image-alt" as const,
      severity: "warning" as const,
      message: "Image has no accessible name",
      role: "img",
      tagName: "img",
      locator: "#hero",
    };
    const v1 = JSON.stringify({
      schemaVersion: 1,
      tool: { name: "real-a11y", version: "0.1.0" },
      pages: [
        {
          name: "Marketing home", // the old join key, and NOT the new identity
          url: "https://example.com/pricing",
          root: "body",
          status: "ok",
          // Hashed the old way: page component = the label.
          findings: fingerprintFindings("Marketing home", [raw]),
          tree: "main",
          outline: "h1 Pricing",
        },
      ],
    });

    const parsed = parseSnapshotArtifact(v1, "base.json");
    expect(parsed.schemaVersion).toBe(ARTIFACT_SCHEMA_VERSION);
    expect(parsed.pages[0].id).toBe("/pricing");
    // The label is untouched — it was only ever a label.
    expect(parsed.pages[0].name).toBe("Marketing home");

    // The real assertion: the converted hash equals what a fresh capture of the
    // same page produces. Anything less and the first diff after upgrading
    // reports an unchanged finding as fixed + new.
    const fresh = fingerprintFindings("/pricing", [raw]);
    expect(parsed.pages[0].findings[0].fingerprint).toBe(fresh[0].fingerprint);
    expect(parsed.pages[0].findings[0].id).toEqual(fresh[0].id);
  });

  it("still refuses a version it has no conversion for", () => {
    try {
      parseSnapshotArtifact(JSON.stringify({ schemaVersion: 999, pages: [] }));
      expect.unreachable();
    } catch (err) {
      expect((err as SnapshotFormatError).message).toContain(
        "schemaVersion 999",
      );
    }
  });

  it("rejects non-JSON and shapeless input", () => {
    expect(() => parseSnapshotArtifact("not json")).toThrow(/not valid JSON/);
    expect(() =>
      parseSnapshotArtifact(
        JSON.stringify({ schemaVersion: ARTIFACT_SCHEMA_VERSION }),
      ),
    ).toThrow(/no "pages" array/);
    expect(() =>
      parseSnapshotArtifact(
        JSON.stringify({
          schemaVersion: ARTIFACT_SCHEMA_VERSION,
          pages: [{ url: "x" }],
        }),
      ),
    ).toThrow(/without a "name"/);
  });

  it("ignores unknown fields and defaults missing view strings", () => {
    const parsed = parseSnapshotArtifact(
      JSON.stringify({
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
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
      JSON.stringify({
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        pages: [{ name: "Home" }],
      }),
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

describe("page identity must be distinct", () => {
  const page = (id: string, url: string): SnapshotPage => ({
    id,
    name: url,
    url,
    root: "body",
    status: "ok",
    findings: [],
    tree: "",
    outline: "",
  });

  it("refuses two pages that share an id, naming both and the remedy", () => {
    // Two sites both rooted at `/`. Joining them would blend their findings —
    // silently, and in a way that reads as a regression on the next diff.
    expect(() =>
      buildArtifact(
        [
          page("/", "https://a.example.com/"),
          page("/", "https://b.example.com/"),
        ],
        { toolName: "t", toolVersion: "0" },
      ),
    ).toThrow(/share the id "\/"/);
    expect(() =>
      buildArtifact(
        [
          page("/", "https://a.example.com/"),
          page("/", "https://b.example.com/"),
        ],
        { toolName: "t", toolVersion: "0" },
      ),
    ).toThrow(/b\.example\.com/);
  });

  it("allows distinct ids, including an explicit one used to break a collision", () => {
    expect(() =>
      buildArtifact(
        [
          page("/", "https://a.example.com/"),
          page("marketing", "https://b.example.com/"),
        ],
        { toolName: "t", toolVersion: "0" },
      ),
    ).not.toThrow();
  });

  it("reports a MISSING id as missing, not as a collision", () => {
    // `id` is required by the type, but tests aren't typechecked here and the
    // package is callable from JS, so a hand-built page can arrive without one.
    // Two such pages both key on `undefined`: the collision branch would then
    // announce a shared route that doesn't exist, sending the reader to the
    // config to break a clash between two pages that have no ids at all.
    const idless = { ...page("x", "https://a.example.com/") } as SnapshotPage;
    // @ts-expect-error -- reproducing what an untyped caller can hand us
    delete idless.id;
    const build = () =>
      buildArtifact([idless, { ...idless, url: "https://b.example.com/" }], {
        toolName: "t",
        toolVersion: "0",
      });
    expect(build).toThrow(/has no id/);
    expect(build).not.toThrow(/share the id/);
    // Names the page it choked on, so the caller knows which one to fix.
    expect(build).toThrow(/a\.example\.com/);
  });
});

describe("legacy artifacts (written before pages had an id)", () => {
  /** A page as an older release wrote it: no `id`, joined on `name`. */
  const legacy = (name: string, url: string) => ({
    name,
    url,
    root: "body",
    status: "ok" as const,
    findings: [],
    tree: "",
    outline: "",
  });
  // Takes an optional `id` so the "explicit ids clash" case below can add one
  // without a cast. It used to be `ReturnType<typeof legacy>[]` with the caller
  // casting — and a cast on a fixture defeats the only check the fixture has.
  const artifact = (pages: (ReturnType<typeof legacy> & { id?: string })[]) =>
    JSON.stringify({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      tool: { name: "real-a11y", version: "0.1.0" },
      createdAt: "2026-01-01T00:00:00.000Z",
      pages,
    });

  it("back-fills the id from the url", () => {
    const a = parseSnapshotArtifact(
      artifact([legacy("Home", "https://example.com/pricing/")]),
      "base.json",
    );
    expect(a.pages[0].id).toBe("/pricing");
  });

  it("stays readable when two sites share a route, joining on name as it did", () => {
    // This file was COHERENT when written — two distinct pages that joined on
    // `name`, diffing correctly for as long as it existed. Hard-erroring here
    // would strand it: the only remedy an in-place error can offer is
    // "re-capture it", which is not open to an archived CI artifact.
    const a = parseSnapshotArtifact(
      artifact([
        legacy("Site A", "https://a.example.com/"),
        legacy("Site B", "https://b.example.com/"),
      ]),
      "base.json",
    );
    expect(a.pages.map((p) => p.id)).toEqual(["Site A", "Site B"]);
  });

  it("only the colliding pages fall back — a lone route keeps its derived id", () => {
    // Otherwise one collision elsewhere in the file would knock an unrelated
    // page off the id a freshly-captured page of that route derives, and the
    // two would stop joining.
    const a = parseSnapshotArtifact(
      artifact([
        legacy("Site A", "https://a.example.com/"),
        legacy("Site B", "https://b.example.com/"),
        legacy("Pricing", "https://a.example.com/pricing"),
      ]),
      "base.json",
    );
    expect(a.pages[2].id).toBe("/pricing");
  });

  it("two legacy artifacts of the same colliding config still join each other", () => {
    const one = parseSnapshotArtifact(
      artifact([
        legacy("Site A", "https://a.example.com/"),
        legacy("Site B", "https://b.example.com/"),
      ]),
      "base.json",
    );
    // Same config, captured against a different environment — the hosts move,
    // the labels don't. Before ids existed these joined on name; they still do.
    const two = parseSnapshotArtifact(
      artifact([
        legacy("Site A", "https://a.preview.example.com/"),
        legacy("Site B", "https://b.preview.example.com/"),
      ]),
      "pr.json",
    );
    expect(two.pages.map((p) => p.id)).toEqual(one.pages.map((p) => p.id));
  });

  it("still refuses when the names collide too — nothing left to join on", () => {
    // Same silent-merge defect, but present in the file as written. Reading it
    // differently cannot recover a distinction that was never recorded.
    expect(() =>
      parseSnapshotArtifact(
        artifact([
          legacy("Home", "https://a.example.com/"),
          legacy("Home", "https://b.example.com/"),
        ]),
        "base.json",
      ),
    ).toThrow(/share the id/);
  });

  it("still refuses two EXPLICIT ids that clash — that artifact is malformed", () => {
    // The fallback is for files that predate identity, not for one that states
    // an identity and states it twice.
    expect(() =>
      parseSnapshotArtifact(
        artifact([
          { ...legacy("Site A", "https://a.example.com/"), id: "/" },
          { ...legacy("Site B", "https://b.example.com/"), id: "/" },
        ]),
        "base.json",
      ),
    ).toThrow(/share the id "\/"/);
  });
});
