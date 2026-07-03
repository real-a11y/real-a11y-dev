/**
 * Assemble a shareable Markdown report of the tree currently shown in the
 * panel. The serialized strings are produced panel-side from the panel's own
 * (merged, scoped) snapshot via `@real-a11y-dev/serialize` — so the export is
 * exactly what's on screen and never depends on the content script. This
 * module is pure string assembly: no Chrome / DOM dependencies.
 */

/** The serialized views, computed from the panel's current tree. */
export interface ExportViews {
  /** The current view's tree (A11y or DOM, whichever is shown). */
  tree: string;
  /** Heading outline (`h1`..`h6`). */
  outline: string;
  /** Tab sequence (focusable nodes in order). */
  tabSequence: string;
}

/** A selectable view — what the user chose to copy. */
export type ExportView = "tree" | "outline" | "tab";

/** Reproducibility context for the report header. */
export interface ExportMeta {
  pageTitle: string;
  pageUrl: string;
  /** ISO timestamp of capture. */
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
export function buildExportMarkdown(
  views: ExportViews,
  meta: ExportMeta,
  selection: ExportView[] = ALL_VIEWS,
): string {
  const sections: Array<{ view: ExportView; heading: string; body: string }> = [
    { view: "tree", heading: meta.viewLabel, body: views.tree },
    { view: "outline", heading: "Heading outline", body: views.outline },
    { view: "tab", heading: "Tab sequence", body: views.tabSequence },
  ];
  const chosen = sections.filter((s) => selection.includes(s.view));
  const title = meta.pageTitle?.trim() || meta.pageUrl || "Untitled page";

  const header = [
    `# Accessibility report — ${title}`,
    "",
    `- **URL:** ${meta.pageUrl || "(unknown)"}`,
  ];
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
