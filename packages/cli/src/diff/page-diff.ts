/**
 * Join two snapshot artifacts page-by-page (by `name`, never URL — base and PR
 * legitimately differ in host/port) and diff each pair. Pure: artifacts in,
 * classified result out, no browser.
 */

import type { SnapshotArtifact, SnapshotPage } from "../snapshot-artifact.js";

import {
  diffFindings,
  summarize,
  type DiffEntry,
  type DiffSummary,
} from "./findings-diff.js";
import { diffViews, type ViewDiff } from "./views-diff.js";

export type PageDiffStatus =
  | "ok"
  | "added" // page only in PR
  | "removed" // page only in base
  | "incomparable"; // one side errored

export interface PageDiff {
  name: string;
  status: PageDiffStatus;
  entries: DiffEntry[];
  views: { tree: ViewDiff; outline: ViewDiff; tabs: ViewDiff };
  /** Why a page is incomparable (the errored side's message). */
  note?: string;
}

export interface DiffResult {
  pages: PageDiff[];
  summary: DiffSummary;
}

const EMPTY_VIEW: ViewDiff = { added: [], removed: [] };
const EMPTY_VIEWS = { tree: EMPTY_VIEW, outline: EMPTY_VIEW, tabs: EMPTY_VIEW };

function pageViews(base: SnapshotPage, pr: SnapshotPage) {
  return {
    tree: diffViews(base.tree, pr.tree),
    outline: diffViews(base.outline, pr.outline),
    tabs: diffViews(base.tabs, pr.tabs),
  };
}

export function diffArtifacts(
  base: SnapshotArtifact,
  pr: SnapshotArtifact,
): DiffResult {
  const baseByName = new Map(base.pages.map((p) => [p.name, p]));
  const seen = new Set<string>();
  const pages: PageDiff[] = [];

  // PR order drives the output; base-only pages are appended after.
  for (const prPage of pr.pages) {
    seen.add(prPage.name);
    const basePage = baseByName.get(prPage.name);
    if (!basePage) {
      pages.push({
        name: prPage.name,
        status: "added",
        entries: diffFindings([], prPage.findings),
        views: EMPTY_VIEWS,
      });
      continue;
    }
    if (basePage.status === "error" || prPage.status === "error") {
      pages.push({
        name: prPage.name,
        status: "incomparable",
        entries: [],
        views: EMPTY_VIEWS,
        note:
          prPage.status === "error"
            ? prPage.error
            : `base snapshot failed: ${basePage.error ?? "unknown"}`,
      });
      continue;
    }
    pages.push({
      name: prPage.name,
      status: "ok",
      entries: diffFindings(basePage.findings, prPage.findings),
      views: pageViews(basePage, prPage),
    });
  }

  for (const basePage of base.pages) {
    if (seen.has(basePage.name)) continue;
    pages.push({
      name: basePage.name,
      status: "removed",
      entries: diffFindings(basePage.findings, []),
      views: EMPTY_VIEWS,
    });
  }

  const summary = summarize(pages.flatMap((p) => p.entries));
  return { pages, summary };
}
