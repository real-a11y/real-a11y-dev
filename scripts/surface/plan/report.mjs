// Render the obligations — for a terminal, and for a PR comment.
//
// Two renderers over one computation, because the audiences differ: locally you
// want to know what's left to do before you push; on the PR you want a note
// that stays true as commits land, and a block you can paste into the body.

import { requiredDocs, scenarioObligations } from "./obligations.mjs";
import { versionStamp } from "./versions.mjs";

const MARK = { added: "+", changed: "~", removed: "−" };

/**
 * @returns the whole report as data, so the two renderers can't disagree about
 * what it says.
 */
export function buildReport(changes, touchedFiles, versionStatus) {
  const touched = new Set(touchedFiles);
  const docs = [...requiredDocs(changes)]
    .map(([path, { reasons, why }]) => ({
      path,
      why,
      reasons: [...reasons],
      touched: touched.has(path),
    }))
    .sort(
      (a, b) =>
        Number(a.touched) - Number(b.touched) || a.path.localeCompare(b.path),
    );

  // Keyed off the CHANGE's kind, not the obligation's action. Only a removed
  // command or tool becomes DEPRECATE; a removed *flag* is an UPDATE to whatever
  // scenario used it — but it is still a removal, so it is still bounded by the
  // last version that had it. Keying off the action stamped removed flags with
  // `Valid from`, which is precisely the transposition this stamp exists to
  // prevent.
  const scenarios = scenarioObligations(changes).map((o, i) => ({
    ...o,
    stamp: versionStamp(
      changes[i].path,
      versionStatus,
      changes[i].kind === "removed",
    ),
  }));

  return {
    changes,
    docs,
    scenarios,
    missingDocs: docs.filter((d) => !d.touched),
  };
}

/** Terminal output — the local `pnpm surface:plan`. */
export function renderText(report) {
  const out = [];

  if (report.changes.length === 0) {
    return 'No public-surface changes on this branch.\n\nNothing in docs/surface.json moved, so §4 and §4b of the `pr` skill have\nnothing to ask of this PR. Say so in the body: "changes nothing user-visible".\n';
  }

  out.push("Surface changes");
  for (const c of report.changes) {
    out.push(`  ${MARK[c.kind]} ${c.path}`);
    out.push(`      ${c.what}${c.detail ? ` — ${c.detail}` : ""}`);
  }

  out.push("", "Docs");
  for (const d of report.docs) {
    out.push(`  ${d.touched ? "✓" : "!"} ${d.path}`);
    if (!d.touched) out.push(`      ${d.why}`);
  }
  // "Nothing in scope" and "everything in scope is done" are opposite facts and
  // an empty `missingDocs` covers both. Reporting the reassuring one for the
  // first is how a contributor concludes their docs are complete for a change
  // this tool simply has no rule for.
  if (report.docs.length === 0) {
    out.push(
      "  — no documented page maps to these changes. That may be right, or it",
      "    may be a gap in the map (scripts/surface/plan/obligations.mjs);",
      "    check §4's table yourself before concluding there's nothing to write.",
    );
  } else if (report.missingDocs.length === 0) {
    out.push("  — every doc in scope was touched on this branch.");
  }

  out.push("", "Scenarios");
  for (const s of report.scenarios) {
    out.push(`  ${s.action.padEnd(10)} ${s.subject}`);
    out.push(`      ${s.note}`);
    if (s.stamp) out.push(`      ${s.stamp}`);
  }
  out.push(
    "",
    "  Scenario IDs aren't resolved: the suites live in Notion, so nothing here",
    "  can say which existing rows assert what moved. Check them by hand and",
    "  record the IDs in the PR body.",
  );

  out.push("", "For the PR body", "", indent(prBodyBlock(report), "  "));
  return out.join("\n") + "\n";
}

function indent(text, prefix) {
  return text
    .split("\n")
    .map((l) => (l ? prefix + l : l))
    .join("\n");
}

/** The paste-ready block: what §4b asks to be recorded. */
export function prBodyBlock(report) {
  const lines = ["## Test scenarios", ""];
  const byAction = (action) =>
    report.scenarios.filter((s) => s.action === action);

  if (report.scenarios.length === 0) {
    lines.push(
      "- **Added:** —",
      "- **Updated:** —",
      "- **Deprecated:** —",
      "- [x] None needed, because: nothing user-visible moved.",
    );
    return lines.join("\n");
  }

  for (const [label, action] of [
    ["Added", "ADD"],
    ["Updated", "UPDATE"],
    ["Deprecated", "DEPRECATE"],
  ]) {
    const items = byAction(action);
    lines.push(
      `- **${label}:** ${
        items.length
          ? items
              .map(
                // `R??` rather than an HTML comment: the placeholder has to
                // survive being quoted inside the instruction below, and a
                // comment nested in a comment ends the outer one at the first
                // `-->`, spilling the rest onto the rendered page.
                (s) => `R?? ${s.subject}${s.stamp ? ` — ${s.stamp}` : ""}`,
              )
              .join(" · ")
          : "—"
      }`,
    );
  }
  lines.push(
    "",
    "<!-- Replace each R?? with the scenario's ID: R12, D4, … -->",
  );
  return lines.join("\n");
}

/**
 * Make a value safe inside a markdown table cell.
 *
 * Both cases are real, not hypothetical. `list`'s summary is
 * "One category: heading|link|button|…", and an unescaped `|` ends the cell
 * there and shifts every column after it. And a usage line is full of
 * `<url>` / `<file>`, which GitHub renders as HTML — the placeholder simply
 * vanishes from the comment, so the reader sees `real-a11y wait [flags]`.
 */
function cell(text) {
  return (
    String(text)
      // Order matters, twice over. `&` first, so the entities introduced below
      // don't get their own ampersand escaped again. And `\` before `|`, or the
      // backslash added to escape a pipe lands next to one already in the input
      // (`\|` → `\\|`) and escapes the backslash instead — putting the pipe back
      // in play as a cell separator, which is the bug this escaping exists to
      // prevent.
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|")
      .replace(/\n/g, " ")
  );
}

/** The sticky PR comment. */
export function renderMarkdown(report, base) {
  if (report.changes.length === 0) {
    return [
      "### 📋 Surface plan",
      "",
      `No public-surface changes vs \`${base}\` — \`docs/surface.json\` is identical.`,
      "",
      "Nothing for §4 (docs) or §4b (scenarios) to ask of this PR. Worth saying so in the body.",
    ].join("\n");
  }

  const out = [
    "### 📋 Surface plan",
    "",
    `This PR moves the public surface. Computed from the \`docs/surface.json\` diff vs \`${base}\` — not from which files changed.`,
    "",
    "<details open><summary><b>What moved</b></summary>",
    "",
    "| | Path | What |",
    "| --- | --- | --- |",
  ];
  for (const c of report.changes) {
    out.push(
      `| \`${MARK[c.kind]}\` | \`${c.path}\` | ${cell(c.what)}${c.detail ? ` — ${cell(c.detail)}` : ""} |`,
    );
  }
  out.push("", "</details>", "");

  if (report.missingDocs.length) {
    out.push(
      `**${report.missingDocs.length} doc${report.missingDocs.length === 1 ? "" : "s"} in scope, untouched by this branch:**`,
      "",
    );
    for (const d of report.missingDocs) {
      out.push(`- \`${d.path}\` — ${d.why}`);
    }
  } else if (report.docs.length === 0) {
    out.push(
      "⚠️ **No documented page maps to these changes.** That may be right, or a gap in the map (`scripts/surface/plan/obligations.mjs`) — worth checking §4's table before concluding there's nothing to write.",
    );
  } else {
    out.push("✅ Every doc in scope was touched on this branch.");
  }
  out.push("");

  out.push("<details><summary><b>Scenarios (§4b)</b></summary>", "");
  for (const s of report.scenarios) {
    out.push(
      `- **${s.action}** — ${s.subject}${s.stamp ? `  \n  \`${s.stamp}\`` : ""}  \n  ${s.note}`,
    );
  }
  out.push(
    "",
    "_IDs aren't resolved — the suites live in Notion, so nothing in the repo can say which existing rows assert what moved._",
    "",
    "</details>",
    "",
    "<details><summary><b>Paste into the PR body</b></summary>",
    "",
    "```markdown",
    prBodyBlock(report),
    "```",
    "",
    "</details>",
  );
  return out.join("\n");
}
