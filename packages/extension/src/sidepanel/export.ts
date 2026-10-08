/**
 * Assemble a shareable Markdown report of the tree currently shown in the
 * panel. The serialized strings are produced panel-side from the panel's own
 * (merged, scoped) snapshot via `@real-a11y-dev/serialize` — so the export is
 * the tree on screen, less its field values (ADR-0001 keeps those out of
 * anything posted), and never depends on the content script. This module is
 * pure string assembly: no Chrome / DOM dependencies.
 */

/** The serialized views, computed from the panel's current tree. */
export interface ExportViews {
  /** The current view's tree (A11y or DOM, whichever is shown). */
  tree: string;
  /** Heading outline (`h1`..`h6`). */
  outline: string;
  /** Tab sequence (focusable nodes in order). Absent for a producer with no
   *  tab-order data: a native tree (see `NATIVE_VIEWS`). */
  tabSequence?: string;
}

/** A selectable view — what the user chose to copy. */
export type ExportView = "tree" | "outline" | "tab";

/** Reproducibility context for the report header. */
export interface ExportMeta {
  /** Which producer built the tree: the tree's own `source.producer`. Printed
   *  in the header so a DOM report and a native one are never compared
   *  without anyone noticing (CLAUDE.md, "Two producers build the tree"). */
  producer: "dom" | "native";
  pageTitle: string;
  pageUrl: string;
  /** ISO timestamp of when the tree was read: the click, for the DOM tree,
   *  which follows the page live; the last read, for a native tree. */
  capturedAt: string;
  /** Extension version, from the manifest. */
  extensionVersion: string;
  /** Heading for the tree section, e.g. `Accessibility tree` / `DOM tree`. */
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
 * Every view a native tree can actually produce — `tab` (tab sequence)
 * omitted. `tabindex` never reaches a native node (see `CLAUDE.md`'s "Two
 * producers build the tree"), so there's no tab-order data to export, not
 * merely an unimplemented one. `getTabSequence` would return an empty
 * sequence for a native tree either way, but rendering that as "(nothing
 * focusable)" would misreport a missing capability as a real finding.
 */
export const NATIVE_VIEWS: ExportView[] = ["tree", "outline"];

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

/**
 * Build the Markdown document: a metadata header followed by a fenced block
 * for each selected view, in canonical order. Defaults to all views. Pastes
 * cleanly into a GitHub issue or any Markdown tracker.
 */
/** What to call a page: its title, or its URL if it has none, or "Untitled
 *  page". The report's heading and the side panel's header both name it so. */
export function pageLabel(
  pageTitle: string | undefined,
  pageUrl: string | undefined,
): string {
  return pageTitle?.trim() || pageUrl || "Untitled page";
}

export function buildExportMarkdown(
  views: ExportViews,
  meta: ExportMeta,
  selection: ExportView[] = ALL_VIEWS,
): string {
  const sections: Array<{ view: ExportView; heading: string; body: string }> = [
    { view: "tree", heading: meta.viewLabel, body: views.tree },
    { view: "outline", heading: "Heading outline", body: views.outline },
    { view: "tab", heading: "Tab sequence", body: views.tabSequence ?? "" },
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
    fenced(s.body),
  ]);

  return [...header, ...body, ""].join("\n");
}
