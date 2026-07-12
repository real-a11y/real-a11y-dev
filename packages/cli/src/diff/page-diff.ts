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
import { diffViews, stripTabIndex, type ViewDiff } from "./views-diff.js";
import { summarizeViews, type ViewChange } from "./views-summary.js";

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
  /** Human structural summary — plain-language statements derived from the
   * view diffs. Advisory: the exit gate never reads it. Empty for
   * added/removed/incomparable pages. */
  structural: ViewChange[];
  /** Why a page is incomparable (the errored side's message). */
  note?: string;
}

export interface DiffOptions {
  /** Drop view lines matching any pattern before diffing (--ignore-view-line)
   * — e.g. a generated "last updated" timestamp that differs on every build. */
  ignoreViewLine?: readonly RegExp[];
}

export interface DiffResult {
  pages: PageDiff[];
  summary: DiffSummary;
}

const EMPTY_VIEW: ViewDiff = { added: [], removed: [] };
const EMPTY_VIEWS = { tree: EMPTY_VIEW, outline: EMPTY_VIEW, tabs: EMPTY_VIEW };

type Ignore = ((trimmedLine: string) => boolean) | undefined;

function pageViews(base: SnapshotPage, pr: SnapshotPage, ignore: Ignore) {
  return {
    tree: diffViews(base.tree, pr.tree, undefined, ignore),
    outline: diffViews(base.outline, pr.outline, undefined, ignore),
    // Tabs are numbered — compare by stop content so one insert isn't a
    // renumber cascade.
    tabs: diffViews(base.tabs, pr.tabs, stripTabIndex, ignore),
  };
}

export function diffArtifacts(
  base: SnapshotArtifact,
  pr: SnapshotArtifact,
  options: DiffOptions = {},
): DiffResult {
  const patterns = options.ignoreViewLine ?? [];
  const ignore: Ignore = patterns.length
    ? (line) => patterns.some((re) => re.test(line))
    : undefined;
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
        structural: [],
      });
      continue;
    }
    if (basePage.status === "error" || prPage.status === "error") {
      pages.push({
        name: prPage.name,
        status: "incomparable",
        entries: [],
        views: EMPTY_VIEWS,
        structural: [],
        note:
          prPage.status === "error"
            ? prPage.error
            : `base snapshot failed: ${basePage.error ?? "unknown"}`,
      });
      continue;
    }
    const views = pageViews(basePage, prPage, ignore);
    pages.push({
      name: prPage.name,
      status: "ok",
      entries: diffFindings(basePage.findings, prPage.findings),
      views,
      structural: summarizeViews({ views, base: basePage, pr: prPage, ignore }),
    });
  }

  for (const basePage of base.pages) {
    if (seen.has(basePage.name)) continue;
    pages.push({
      name: basePage.name,
      status: "removed",
      entries: diffFindings(basePage.findings, []),
      views: EMPTY_VIEWS,
      structural: [],
    });
  }

  const summary = summarize(pages.flatMap((p) => p.entries));
  return { pages, summary };
}
