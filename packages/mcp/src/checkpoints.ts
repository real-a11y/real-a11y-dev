/**
 * A11y snapshot **checkpoints** — the Axis-B (findings) diff, inside the MCP
 * server. An agent saves a named checkpoint of the live page, then asks what
 * findings are new / changed / fixed after a change — with the *same* identity
 * semantics (`v1:` fingerprints) the CI a11y-diff bot uses, guaranteed by the
 * shared `buildSnapshotPage` in `@real-a11y-dev/snapshot`.
 *
 * This module is the pure, testable core: the in-memory store and the diff
 * rendering. The tool wiring lives in `server.ts`.
 */

import {
  buildArtifact,
  diffArtifacts,
  fingerprintFindings,
  type DiffClass,
  type DiffEntry,
  type DiffResult,
  type FingerprintedFinding,
  type SnapshotArtifact,
  type SnapshotPage,
} from "@real-a11y-dev/snapshot";

/** Default number of checkpoints retained before the oldest is evicted. */
export const MAX_CHECKPOINTS = 20;

/**
/**
 * A stored checkpoint: the snapshotted page plus the rule subset it was
 * captured with. The rules are remembered so a later `diff_checkpoint`
 * re-snapshots with the SAME rules — otherwise a checkpoint saved with a subset
 * would diff against an all-rules re-snapshot and report the omitted rules'
 * findings as spurious NEW (or FIXED). `undefined` means "all rules".
 */
export interface Checkpoint {
  page: SnapshotPage;
  rules?: string[];
}

/**
 * A bounded, insertion-ordered store of named checkpoints. Re-saving a name
 * moves it to newest; once full, the least-recently-saved checkpoint is
 * evicted, so a runaway agent can't grow the map without bound.
 */
export class CheckpointStore<T = Checkpoint> {
  private readonly map = new Map<string, T>();

  constructor(private readonly cap: number = MAX_CHECKPOINTS) {}

  save(name: string, value: T): void {
    this.map.delete(name); // re-save ⇒ move to newest
    this.map.set(name, value);
    while (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }

  get(name: string): T | undefined {
    return this.map.get(name);
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  entries(): Array<[string, T]> {
    return [...this.map];
  }
}

// The artifact metadata is irrelevant to the findings diff (diffArtifacts joins
// pages by name and matches findings by fingerprint) — a placeholder is fine.
const DIFF_META = { toolName: "@real-a11y-dev/mcp", toolVersion: "0" } as const;

function asArtifact(page: SnapshotPage): SnapshotArtifact {
  return buildArtifact([page], DIFF_META);
}

/**
 * Diff two checkpoint pages that were fingerprinted under the **same** page
 * name (the `save_checkpoint`/`diff_checkpoint` pair, or a re-snapshot vs its
 * stored base). Their fingerprints are directly comparable.
 */
export function diffCheckpointPages(
  base: SnapshotPage,
  head: SnapshotPage,
): DiffResult {
  return diffArtifacts(asArtifact(base), asArtifact(head));
}

/**
 * Diff two **independently-labeled** checkpoints (`diff_checkpoints`). Each was
 * fingerprinted under its own label as the page name — and `page` is part of
 * the `v1` fingerprint tuple — so a naive diff would read every finding as
 * removed+new. Re-fingerprint both under one neutral name first; the identity
 * *components* (rule, role, locator, …) are unchanged, so matching findings
 * collapse correctly.
 */
export function diffLabeledCheckpoints(
  base: SnapshotPage,
  head: SnapshotPage,
): DiffResult {
  const NAME = "checkpoint";
  const rename = (p: SnapshotPage): SnapshotPage => ({
    ...p,
    name: NAME,
    findings: fingerprintFindings(NAME, p.findings),
  });
  return diffCheckpointPages(rename(base), rename(head));
}

// ── rendering ────────────────────────────────────────────────────────────

/** Cap per-section entries so a massively-changed page produces a bounded,
 *  readable delta rather than thousands of lines. A pathological diff (hundreds
 *  of long messages) can still brush the server's outer `bounded()` cap — that
 *  mid-line truncation is acceptable for human-readable text, unlike the JSON
 *  export, which errors rather than emit invalid JSON. */
const MAX_ENTRIES = 200;
const MAX_STRUCTURAL = 50;

function fmtFinding(f: FingerprintedFinding): string {
  const where = f.locator ? `  ${f.locator}` : "";
  return `[${f.severity}] ${f.rule}: ${f.message}${where}`;
}

/**
 * Render a {@link DiffResult} as a compact, agent-readable delta: NEW (the only
 * class that gates CI) → CHANGED → FIXED, plus an advisory structural summary.
 */
export function renderDiff(
  diff: DiffResult,
  labels?: { base: string; head: string },
): string {
  const s = diff.summary;
  const title = labels
    ? `Checkpoint diff ${labels.base} → ${labels.head}`
    : "Checkpoint diff (vs. saved)";
  const header = `${title}: ${s.new} new, ${s.removed} fixed, ${s.changed} changed, ${s.unchanged} unchanged.`;

  if (s.new + s.removed + s.changed === 0) {
    return `${header}\nNo accessibility findings changed.`;
  }

  const out: string[] = [header];
  const pick = (entries: DiffEntry[], kind: DiffClass) =>
    entries.filter((e) => e.kind === kind);

  const section = (
    heading: string,
    entries: DiffEntry[],
    mark: string,
    withChanges = false,
  ) => {
    if (entries.length === 0) return;
    out.push("", `${heading} (${entries.length}):`);
    for (const e of entries.slice(0, MAX_ENTRIES)) {
      const delta =
        withChanges && e.changes?.length ? `  — ${e.changes.join("; ")}` : "";
      out.push(`  ${mark} ${fmtFinding(e.finding)}${delta}`);
    }
    if (entries.length > MAX_ENTRIES) {
      out.push(`  … +${entries.length - MAX_ENTRIES} more`);
    }
  };

  for (const page of diff.pages) {
    section("NEW — gates CI", pick(page.entries, "new"), "✖");
    section("CHANGED", pick(page.entries, "changed"), "~", true);
    section("FIXED", pick(page.entries, "removed"), "✓");

    if (page.structural.length > 0) {
      out.push("", "Structural changes (advisory):");
      for (const c of page.structural.slice(0, MAX_STRUCTURAL)) {
        out.push(`  • ${c.message}`);
      }
      if (page.structural.length > MAX_STRUCTURAL) {
        out.push(`  … +${page.structural.length - MAX_STRUCTURAL} more`);
      }
    }
  }

  return out.join("\n");
}
