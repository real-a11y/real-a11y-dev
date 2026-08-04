import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Finding } from "@real-a11y-dev/audit";
import { describe, expect, it } from "vitest";

import {
  applyBaseline,
  BASELINE_SCHEMA_VERSION,
  buildBaseline,
  loadBaseline,
  serializeBaseline,
  type BaselinePage,
} from "./baseline.js";
import { fingerprintFindings } from "./fingerprint.js";

const raw = (over: Partial<Finding> = {}): Finding =>
  ({
    rule: "unlabeled-interactive",
    severity: "error",
    message: "Unlabeled interactive element: button <button>",
    role: "button",
    tagName: "button",
    locator: "#nav > ul > li:nth-of-type(2) > button",
    context: "",
    ...over,
  }) as Finding;

// `id` is the bucket key; `name` is the label. They differ here on purpose so a
// test that accidentally keys on the label fails instead of passing by accident.
const page = (name: string, findings: Finding[]): BaselinePage => ({
  id: `/${name.toLowerCase()}`,
  name,
  findings: fingerprintFindings(`/${name.toLowerCase()}`, findings),
});

describe("buildBaseline", () => {
  it("records every current finding, added = all when fresh", () => {
    const pages = [page("Home", [raw(), raw({ locator: "#foo > button" })])];
    const { baseline, added, removed } = buildBaseline(pages);
    expect(baseline.schemaVersion).toBe(BASELINE_SCHEMA_VERSION);
    expect(baseline.entries).toHaveLength(2);
    expect(added).toBe(2);
    expect(removed).toBe(0);
    expect(baseline.entries[0].page).toBe("Home");
    expect(baseline.entries[0].fingerprint).toMatch(/^v1:/);
  });

  it("is deterministic — a re-run serializes identically", () => {
    const pages = [
      page("B", [raw({ locator: "#b > button" })]),
      page("A", [
        raw({ locator: "#a2 > button" }),
        raw({ locator: "#a1 > button" }),
      ]),
    ];
    const one = serializeBaseline(buildBaseline(pages).baseline);
    const two = serializeBaseline(buildBaseline(pages).baseline);
    expect(one).toBe(two);
    // Sorted by page then fingerprint — "A" before "B".
    expect(one.indexOf('"page": "A"')).toBeLessThan(one.indexOf('"page": "B"'));
  });

  it("carries forward notes on still-matched entries and counts churn", () => {
    const current = [page("Home", [raw(), raw({ locator: "#new > button" })])];
    const old = buildBaseline([page("Home", [raw()])]).baseline;
    old.entries[0].note = "tracked in JIRA-42";

    const { baseline, added, removed } = buildBaseline(current, old);
    expect(added).toBe(1); // the #new one
    expect(removed).toBe(0);
    const kept = baseline.entries.find((e) => e.note);
    expect(kept?.note).toBe("tracked in JIRA-42");
  });
});

describe("applyBaseline", () => {
  it("suppresses accepted findings, leaves new ones, and gates only new", () => {
    const baseline = buildBaseline([page("Home", [raw()])]).baseline;
    const current = page("Home", [raw(), raw({ locator: "#new > button" })]);

    const { suppressed, stale } = applyBaseline([current], baseline);
    expect(suppressed).toBe(1);
    expect(stale).toHaveLength(0);
    const accepted = current.findings.find((f) => f.suppressed);
    const fresh = current.findings.find((f) => !f.suppressed);
    expect(accepted?.locator).toContain("#nav");
    expect(fresh?.locator).toContain("#new");
  });

  it("survives a renumbered :nth-of-type locator (matcher, not string eq)", () => {
    // Sibling inserted before it → nth-of-type(2) → (3). Same accepted finding.
    const baseline = buildBaseline([page("Home", [raw()])]).baseline;
    const current = page("Home", [
      raw({ locator: "#nav > ul > li:nth-of-type(3) > button" }),
    ]);
    const { suppressed, stale } = applyBaseline([current], baseline);
    expect(suppressed).toBe(1);
    expect(stale).toHaveLength(0);
  });

  it("reports entries that no longer match as stale (never a failure)", () => {
    const baseline = buildBaseline([page("Home", [raw()])]).baseline;
    const current = page("Home", [raw({ locator: "#different > button" })]);
    const { suppressed, stale } = applyBaseline([current], baseline);
    expect(suppressed).toBe(0);
    expect(stale).toHaveLength(1);
    expect(stale[0].page).toBe("Home");
  });

  it("treats a page dropped from the run as stale", () => {
    const baseline = buildBaseline([page("Gone", [raw()])]).baseline;
    const { stale } = applyBaseline([page("Home", [])], baseline);
    expect(stale).toHaveLength(1);
    expect(stale[0].page).toBe("Gone");
  });
});

describe("loadBaseline", () => {
  it("round-trips through the file system", () => {
    const dir = mkdtempSync(join(tmpdir(), "a11y-baseline-"));
    const file = join(dir, ".a11y-baseline.json");
    const built = buildBaseline([page("Home", [raw()])]).baseline;
    writeFileSync(file, serializeBaseline(built));
    const loaded = loadBaseline(file);
    expect(loaded.entries).toEqual(built.entries);
  });

  it("fails closed on a schema mismatch", () => {
    const dir = mkdtempSync(join(tmpdir(), "a11y-baseline-"));
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ schemaVersion: 99, entries: [] }));
    expect(() => loadBaseline(file)).toThrow(/schemaVersion/);
  });

  it("fails closed on a missing file", () => {
    expect(() => loadBaseline("/nope/does-not-exist.json")).toThrow(
      /not found/,
    );
  });
});

describe("identity is the page id, not its label", () => {
  // The defect this split exists for. Recorded against a page, then the page is
  // renamed for readability — accepted debt must survive, because renaming a
  // label is not a claim about what the page is.
  const findings = [raw()];

  it("a renamed page keeps suppressing its accepted debt", () => {
    const recorded = { id: "/pricing", name: "http://localhost:3000/pricing" };
    const renamed = { id: "/pricing", name: "Pricing page" };

    const { baseline } = buildBaseline([
      { ...recorded, findings: fingerprintFindings(recorded.id, findings) },
    ]);
    const { suppressed, stale } = applyBaseline(
      [{ ...renamed, findings: fingerprintFindings(renamed.id, findings) }],
      baseline,
    );
    expect(suppressed).toBe(1);
    expect(stale).toEqual([]);
  });

  it("still un-suppresses when the page genuinely is a different page", () => {
    // The other half: identity must not become so loose that moving a finding
    // to another route silently keeps it accepted.
    const { baseline } = buildBaseline([
      {
        id: "/pricing",
        name: "P",
        findings: fingerprintFindings("/pricing", findings),
      },
    ]);
    const { suppressed, stale } = applyBaseline(
      [
        {
          id: "/careers",
          name: "C",
          findings: fingerprintFindings("/careers", findings),
        },
      ],
      baseline,
    );
    expect(suppressed).toBe(0);
    expect(stale).toHaveLength(1);
  });

  it("carries across environments — the same route on a different host", () => {
    const { baseline } = buildBaseline([
      {
        id: "/pricing",
        name: "localhost",
        findings: fingerprintFindings("/pricing", findings),
      },
    ]);
    const { suppressed } = applyBaseline(
      [
        {
          id: "/pricing",
          name: "prod",
          findings: fingerprintFindings("/pricing", findings),
        },
      ],
      baseline,
    );
    expect(suppressed).toBe(1);
  });
});
