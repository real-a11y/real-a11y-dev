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
export function buildReport(
  changes,
  touchedFiles,
  versionStatus,
  knownScenarios,
) {
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
  const scenarios = scenarioObligations(changes, knownScenarios).map(
    (o, i) => ({
      ...o,
      stamp: versionStamp(
        changes[i].path,
        versionStatus,
        changes[i].kind === "removed",
      ),
    }),
  );

  // A scenario file the branch already edited needs no nagging about. Same rule
  // the docs half uses: report what is still outstanding, not what is done.
  const scenarioFiles = new Map(
    (knownScenarios ?? []).map((s) => [s.id, s.file]),
  );
  const untouched = (ids) =>
    ids.filter((id) => {
      const file = scenarioFiles.get(id);
      return !file || !touched.has(file);
    });

  return {
    changes,
    docs,
    scenarios: scenarios.map((s) => ({
      ...s,
      idsUntouched: untouched(s.ids),
      twinsUntouched: untouched(s.twins),
    })),
    missingDocs: docs.filter((d) => !d.touched),
    scenariosResolvable:
      Array.isArray(knownScenarios) && knownScenarios.length > 0,
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
    if (s.stamp) out.push(`      ${s.stamp.text}`);
    if (s.ids.length) {
      out.push(`      covered by: ${s.ids.join(", ")}`);
      // Flag what is still outstanding separately from what covers it. A branch
      // that already edited the row needs no reminder, and a list that keeps
      // naming finished work is one people stop reading.
      if (s.idsUntouched.length && s.idsUntouched.length !== s.ids.length) {
        out.push(`      not yet touched: ${s.idsUntouched.join(", ")}`);
      }
    }
    if (s.twins.length) {
      out.push(
        `      twin${s.twins.length > 1 ? "s" : ""}: ${s.twins.join(", ")} ` +
          `— the other altitude asserts the same subject`,
      );
    }
  }
  if (!report.scenariosResolvable) {
    out.push(
      "",
      "  Scenario IDs aren't resolved: no scenarios/ directory was found, so",
      "  nothing here can say which existing rows assert what moved. Check them",
      "  by hand and record the IDs in the PR body.",
    );
  } else if (report.scenarios.every((s) => !s.ids.length)) {
    out.push(
      "",
      "  Nothing in scenarios/ covers any of these paths. For a new capability",
      "  that is expected — write the row. For a change to something that ships,",
      "  it means the surface had no scenario to begin with, which is its own",
      "  finding: pnpm surface:scenarios reports the coverage gaps.",
    );
  }

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
              .map((s) => {
                // Real IDs when they resolve. `R??` only survives as a
                // placeholder for the case nothing covers the path — a new
                // capability, where there genuinely is no row yet and the author
                // has to supply the id of the one they write.
                //
                // It stays a literal `R??` rather than an HTML comment because
                // the placeholder has to survive being quoted inside the
                // instruction below, and a comment nested in a comment ends the
                // outer one at the first `-->`, spilling the rest onto the page.
                const who = s.ids.length ? s.ids.join(", ") : "R??";
                // Only a real stamp. A note explains why there is no version;
                // pasting it into the row as though it were one is noise, and
                // the report body already says it.
                const stamp =
                  s.stamp?.kind === "stamp" ? ` — ${s.stamp.text}` : "";
                return `${who} ${s.subject}${stamp}`;
              })
              .join(" · ")
          : "—"
      }`,
    );
  }
  // Only ask for a substitution when one is actually pending. An instruction to
  // replace a placeholder that isn't there sends the reader looking for it.
  if (report.scenarios.some((s) => !s.ids.length)) {
    lines.push(
      "",
      "<!-- Replace each R?? with the scenario's ID: R12, D4, … -->",
    );
  }
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

/**
 * A scenario's version line for the comment. A stamp is a value, so it gets a
 * code span; a note is prose that contains backticks of its own, and wrapping
 * THAT in a code span ends the span at the first one and mangles the rest —
 * which the CI path hit every time, since a job with no node_modules can never
 * read changesets and always produces a note.
 */
function stampMarkdown(stamp) {
  if (!stamp) return "";
  // Two trailing spaces = a markdown hard line break.
  const text = stamp.kind === "stamp" ? `\`${stamp.text}\`` : stamp.text;
  return `  \n  ${text}`;
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
    let line = `- **${s.action}** — ${s.subject}${stampMarkdown(s.stamp)}  \n  ${s.note}`;
    if (s.ids.length) {
      const outstanding =
        s.idsUntouched.length && s.idsUntouched.length !== s.ids.length
          ? ` (still untouched: ${s.idsUntouched.map((i) => `\`${i}\``).join(", ")})`
          : "";
      line += `  \n  Covered by ${s.ids.map((i) => `\`${i}\``).join(", ")}${outstanding}`;
    }
    if (s.twins.length) {
      line += `  \n  Twin${s.twins.length > 1 ? "s" : ""} ${s.twins.map((i) => `\`${i}\``).join(", ")} assert the same subject at the other altitude.`;
    }
    out.push(line);
  }
  if (!report.scenariosResolvable) {
    out.push(
      "",
      "_IDs aren't resolved — no `scenarios/` directory was found, so nothing in the repo can say which existing rows assert what moved._",
    );
  } else if (report.scenarios.every((s) => !s.ids.length)) {
    out.push(
      "",
      "_Nothing in `scenarios/` covers any of these paths. Expected for a new capability; for a change to something that already ships it means the surface had no scenario to begin with — `pnpm surface:scenarios` reports the gaps._",
    );
  }
  out.push(
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
