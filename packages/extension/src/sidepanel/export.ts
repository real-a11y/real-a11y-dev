/**
 * Assemble a shareable Markdown report of the tree currently shown in the
 * panel. The serialized strings are produced panel-side from the panel's own
 * (scoped) snapshot via `@real-a11y-dev/serialize` — so the export is the
 * tree on screen, less its field values (ADR-0001 keeps those out of anything
 * posted), and never depends on the content script. This module is pure
 * string assembly: no Chrome / DOM dependencies.
 */

/** The serialized views, computed from the panel's current trees. */
export interface ExportViews {
  /** Chrome's tree, as read. */
  tree: string;
  /** Heading outline (`h1`..`h6`). */
  outline: string;
  /** Tab sequence (focusable nodes in order), from the page's own walk:
   *  Chrome's tree has no tab order (see `exportViewsFor`). */
  tabSequence?: string;
}

/** A selectable view — what the user chose to copy. */
export type ExportView = "tree" | "outline" | "tab";

/** Reproducibility context for the report header. */
export interface ExportMeta {
  /** Which producer built the tree: the tree's own `source.producer`, or
   *  `dom` for a report of the tab sequence alone. Printed in the header so
   *  a DOM report and a native one are never compared without anyone
   *  noticing (CLAUDE.md, "Two producers build the tree"). */
  producer: "dom" | "native";
  pageTitle: string;
  pageUrl: string;
  /** ISO timestamp of when the tree was read: the last read, for a native
   *  tree; the click, for the tab sequence alone, which follows the page live
   *  while it shows. */
  capturedAt: string;
  /** Extension version, from the manifest. */
  extensionVersion: string;
  /** Heading for the tree section, e.g. `Native accessibility tree`. */
  viewLabel: string;
  /**
   * When the panel is scoped to a subtree, a label for it (e.g.
   * `dialog "Confirm"`). Recorded in the header so the report says it
   * covers only that scope, not the whole page.
   */
  scope?: string;
}

/** Every view, in canonical order — the default "copy everything". */
export const ALL_VIEWS: ExportView[] = ["tree", "outline", "tab"];

/**
 * The views the Copy menu offers: Chrome's tree and its headings once a read
 * has put one on screen (`treeShown`), and the tab sequence while the TAB view
 * shows it (`tabOrderShown`). A read Chrome refused leaves the tab sequence
 * alone to copy. `tabindex` never
 * reaches a native node (see `CLAUDE.md`'s "Two producers build the tree"), so
 * the tab sequence is the page's own walk's, which the page sends whole only
 * while the TAB view shows. `getTabSequence` would return an empty sequence
 * for a native tree, and rendering that as "(nothing focusable)" would
 * misreport a missing capability as a real finding.
 */
export function exportViewsFor(
  treeShown: boolean,
  tabOrderShown: boolean,
): ExportView[] {
  return ALL_VIEWS.filter((view) =>
    view === "tab" ? tabOrderShown : treeShown,
  );
}

const PRODUCER_LABELS: Record<ExportMeta["producer"], string> = {
  dom: "dom (the extension's own in-page walk)",
  native: "native (Chromium's own accessibility tree)",
};

/** What the Copy menu calls each view. */
export const VIEW_LABELS: Record<Exclude<ExportView, "tree">, string> = {
  outline: "Headings",
  tab: "Tab sequence",
};

function fenced(body: string): string {
  // The serialized trees never contain a ``` fence, so a plain triple-fence
  // is safe. Fall back to a placeholder for empty views so the section still
  // reads sensibly in a bug report.
  return ["```", body.trim() ? body : "(empty)", "```"].join("\n");
}

/** What to call a page: its title, or its URL if it has none, or "Untitled
 *  page". The report's heading and the side panel's header both name it so. */
export function pageLabel(
  pageTitle: string | undefined,
  pageUrl: string | undefined,
): string {
  return pageTitle?.trim() || pageUrl || "Untitled page";
}

/**
 * Build the Markdown document: a metadata header followed by a fenced block
 * for each selected view, in canonical order. Defaults to all views. Pastes
 * cleanly into a GitHub issue or any Markdown tracker.
 */
export function buildExportMarkdown(
  views: ExportViews,
  meta: ExportMeta,
  selection: ExportView[] = ALL_VIEWS,
): string {
  const sections: Array<{
    view: ExportView;
    heading: string;
    body: string;
    producer?: ExportMeta["producer"];
  }> = [
    { view: "tree", heading: meta.viewLabel, body: views.tree },
    { view: "outline", heading: "Heading outline", body: views.outline },
    // Always the page's own walk's: a report of Chrome's tree says so here,
    // as its header names Chrome's.
    {
      view: "tab",
      heading: "Tab sequence",
      body: views.tabSequence ?? "",
      producer: "dom",
    },
  ];
  const chosen = sections.filter((s) => selection.includes(s.view));
  const title = pageLabel(meta.pageTitle, meta.pageUrl);

  const header = [
    `# Accessibility report — ${title}`,
    "",
    `- **URL:** ${meta.pageUrl || "(unknown)"}`,
  ];
  header.push(`- **Producer:** ${PRODUCER_LABELS[meta.producer]}`);
  if (meta.scope) header.push(`- **Scope:** ${meta.scope}`);
  header.push(
    `- **Captured:** ${meta.capturedAt}`,
    `- **Tool:** Semantic Navigator ${meta.extensionVersion}`,
  );

  const body = chosen.flatMap((s) => [
    "",
    `## ${s.heading}`,
    "",
    ...(s.producer && s.producer !== meta.producer
      ? [`**Producer:** ${PRODUCER_LABELS[s.producer]}`, ""]
      : []),
    // The tab order is the whole page's, whatever the tree is scoped to.
    ...(s.view === "tab" && meta.scope
      ? ["**Scope:** the whole page", ""]
      : []),
    fenced(s.body),
  ]);

  return [...header, ...body, ""].join("\n");
}
