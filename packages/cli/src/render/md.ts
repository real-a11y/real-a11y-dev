/**
 * Human markdown rendering of a snapshot artifact (`snapshot --md`) — the
 * successor to the diff-bot guide's copy-pasted markdown snapshot, but with a
 * findings section the old format lacked. Page-derived text lives only inside
 * fenced blocks (it's already sanitized at the browser edge, but fences keep an
 * accessible name from ever rendering as markdown).
 */

import type { SnapshotArtifact, SnapshotPage } from "../snapshot-artifact.js";

/** Which axis of the report to render; undefined = both. Mirrors the diff
 * renderer's filter — an OUTPUT concern only (the --fail-on gate always runs
 * on the full findings, and the JSON artifact is never filtered). */
export type SnapshotSection = "findings" | "views";

function fence(body: string): string {
  return `\`\`\`\n${body.trim() === "" ? "(empty)" : body}\n\`\`\``;
}

function pageSection(page: SnapshotPage, only?: SnapshotSection): string {
  const parts: string[] = [`## ${page.name}`, ""];
  if (page.status === "error") {
    parts.push(`> Snapshot failed: ${page.error ?? "unknown error"}`, "");
    return parts.join("\n");
  }
  // `--only views` is an EXPORT of the structure — no findings content at
  // all, not even the count (a --fail-on exit is explained on stderr by the
  // snapshot command instead, where CI logs show it next to the exit code).
  if (only !== "views") {
    const errors = page.findings.filter((f) => f.severity === "error").length;
    const warnings = page.findings.length - errors;
    parts.push(
      `${page.findings.length} issue(s) — ${errors} error(s), ${warnings} warning(s)`,
      "",
    );
    for (const f of page.findings) {
      const where = f.locator ? ` \`${f.locator}\`` : "";
      parts.push(`- [${f.severity}] \`${f.rule}\`: ${f.message}${where}`);
    }
    if (page.findings.length) parts.push("");
  }
  if (only !== "findings") {
    parts.push(
      "### Semantic tree",
      fence(page.tree),
      "",
      "### Heading outline",
      fence(page.outline),
      "",
      "### Tab order",
      fence(page.tabs),
      "",
    );
  }
  return parts.join("\n");
}

export function renderSnapshotMarkdown(
  artifact: SnapshotArtifact,
  only?: SnapshotSection,
): string {
  const header = `# Accessibility snapshot — ${artifact.pages.length} page(s)`;
  return `${[header, "", ...artifact.pages.map((p) => pageSection(p, only))].join("\n")}`;
}
