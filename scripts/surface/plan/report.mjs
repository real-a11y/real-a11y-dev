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
  repoRoot,
) {
  const touched = new Set(touchedFiles);
  const docs = [...requiredDocs(changes, repoRoot)]
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
    // Package source moved while the inventory didn't. That is the shape of an
    // OUTPUT change — a reworded error, a new empty-category line, a diff header
    // — and it is exactly the case where "no surface changes" is true of the
    // manifest and wrong as advice. See `renderText`'s zero-change branch.
    sourceChanged: [...touched].some((f) => /^packages\/[^/]+\/src\//.test(f)),
  };
}

/** Terminal output — the local `pnpm surface:plan`. */
export function renderText(report) {
  const out = [];

  // The zero-change branch says only what it measured.
  //
  // It used to conclude "nothing user-visible" and hand over a ready-made §4b
  // opt-out. That is true of the inventory and false in general: a branch that
  // reworded the MCP checkpoint-diff headers and `list`'s empty-category line
  // moved no command, tool, flag or env var — and still obliged three docs and
  // three scenarios. The docs got mapped by hand while this printed the
  // opposite.
  //
  // The failure mode is the inverse of the one this tool fixes. A table nobody
  // reads gets ignored; a confident "nothing to do" gets believed. So: report the
  // inventory, and let the author answer the part that isn't modelled.
  if (report.changes.length === 0) {
    const lines = [
      "No changes to the command / tool / flag / env inventory on this branch.",
      "",
      "Nothing in docs/surface.json moved. That covers WHAT exists — not what any",
      'of it prints, so it is not the same as "nothing user-visible".',
    ];
    if (report.sourceChanged) {
      lines.push(
        "",
        "  ! packages/*/src changed while the inventory did not — the shape of an",
        "    output change. Did any printed text, error message, log line or exit",
        "    code move? If so, §4 and §4b still apply and this report cannot see it:",
        "    documented OUTPUT is unmodelled, on the check side and here.",
      );
    }
    lines.push(
      "",
      "If nothing a user reads changed either, say so in the body — but say it",
      "because you checked, not because this printed it.",
      "",
      "For the PR body",
      "",
      indent(prBodyBlock(report), "  "),
    );
    return lines.join("\n") + "\n";
  }

  out.push("Surface changes");
  for (const c of report.changes) {
    out.push(`  ${MARK[c.kind]} ${c.path}`);
    out.push(`      ${c.what}${c.detail ? ` — ${c.detail}` : ""}`);
  }

  out.push("", "Docs & community skills");
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
      "  — no documented page or community skill maps to these changes. That",
      "    may be right, or it may be a gap in the map",
      "    (scripts/surface/plan/obligations.mjs); check §4's table yourself",
      "    before concluding there's nothing to write.",
    );
  } else if (report.missingDocs.length === 0) {
    out.push("  — every doc / skill in scope was touched on this branch.");
  }

  out.push("", "Scenarios");
  for (const s of report.scenarios) {
    out.push(`  ${s.action.padEnd(10)} ${s.subject}`);
    out.push(`      ${s.note}`);
    if (s.stamp) out.push(`      ${s.stamp.text}`);
    if (s.ids.length) {
      const label = (id) =>
        s.deprecated?.includes(id) ? `${id} (Deprecated)` : id;
      out.push(`      covered by: ${s.ids.map(label).join(", ")}`);
      // A retired row is not coverage. `checkScenarios` already treats
      // deprecated-only as a gap, so saying so here keeps the two halves of the
      // same tool from disagreeing about the same fact.
      if (s.deprecated?.length && s.deprecated.length === s.ids.length) {
        out.push(
          `      ⚠ every row naming this is Deprecated — that is a coverage gap,`,
          `        not coverage. pnpm surface:scenarios will fail on it.`,
        );
      }
      // Always say which side of done this is on. Suppressing the line when
      // EVERY covering row was outstanding made "nothing updated yet" and
      // "all of them updated" render identically — the same collapse of two
      // opposite facts that the docs half above is commented to avoid, and the
      // "nothing updated yet" case is the one that actually needs the nudge.
      if (s.idsUntouched.length) {
        out.push(`      not yet touched: ${s.idsUntouched.join(", ")}`);
      } else {
        out.push(`      — every covering scenario was touched on this branch.`);
      }
    }
    if (s.twins.length) {
      // Same "always say which side of done" rule as the ids above. Printing the
      // twin unconditionally kept nagging about a companion row the branch had
      // already edited — and `twinsUntouched` was computed for exactly this and
      // then never read, which is how the inconsistency survived.
      const done = s.twinsUntouched.length === 0;
      out.push(
        `      twin${s.twins.length > 1 ? "s" : ""}: ${s.twins.join(", ")} ` +
          `— the other altitude asserts the same subject`,
      );
      out.push(
        done
          ? `        ✓ already touched on this branch`
          : `        still to check: ${s.twinsUntouched.join(", ")}`,
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

  // Reached only from the zero-change paths of the two renderers. One obligation
  // is produced per change, so no scenarios means no changes — and until those
  // paths started calling this, the branch was unreachable and its old pre-ticked
  // `- [x] None needed, because: nothing user-visible moved.` had never once been
  // shown to anyone.
  if (report.scenarios.length === 0) {
    lines.push("- **Added:** —", "- **Updated:** —", "- **Deprecated:** —");
    // UNTICKED, and the reason left blank on purpose.
    //
    // This block gets pasted into a PR body verbatim, so a pre-ticked box with a
    // reason already filled in is the tool asserting something it did not check.
    // §4b's whole point is that a blank scenario answer and a forgotten one are
    // indistinguishable — a pre-ticked one is worse than either. The inventory is
    // all that was measured; whether any output moved is the author's to answer.
    lines.push(
      report.sourceChanged
        ? "- [ ] None needed, because: <!-- the inventory didn't move, but packages/*/src did — confirm no printed output, error message or exit code changed -->"
        : "- [ ] None needed, because: <!-- say why. The inventory didn't move, which is not the same as nothing user-visible. -->",
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

/**
 * Machine-readable "there is nothing here worth posting".
 *
 * LOAD-BEARING: `.github/workflows/docs-currency.yml` matches on this exact
 * string to decide whether to post a sticky comment at all. Change it in both
 * places or not at all.
 *
 * It exists because the workflow used to match on the report's PROSE
 * (`report.includes("No public-surface changes")`). Rewording the renderer — the
 * whole point of this change — silently made that test always false, so every PR
 * with no inventory movement would have got a full comment and no existing
 * comment would ever have cleared. Prose that automation depends on is prose
 * nobody can edit; a sentinel says so out loud.
 */
export const NOTHING_TO_REPORT = "<!-- surface-plan:silent -->";

/** The sticky PR comment. */
export function renderMarkdown(report, base) {
  // Narrowed for the same reason as the terminal renderer, and this is the copy
  // that matters most: it lands on the PR where reviewers read it, so a confident
  // "nothing to do" here is the version most likely to be taken at face value.
  if (report.changes.length === 0) {
    const out = [
      "### 📋 Surface plan",
      "",
      `No changes to the command / tool / flag / env inventory vs \`${base}\` — \`docs/surface.json\` is identical.`,
      "",
      'That covers **what exists**, not what any of it prints — so it is not the same as "nothing user-visible".',
    ];
    if (report.sourceChanged) {
      // There IS something to say here, so this case is deliberately NOT marked
      // silent: the inventory didn't move but source did, which is the shape of
      // an output change and the whole reason this PR exists.
      out.push(
        "",
        "> ⚠️ `packages/*/src` changed while the inventory did not — the shape of an **output** change.",
        "> Did any printed text, error message, log line or exit code move? If so §4 and §4b still apply,",
        "> and this report cannot see it: documented output is unmodelled, here and in `surface:check`.",
      );
    } else {
      // Nothing moved and no source changed — genuinely nothing to post.
      out.push("", NOTHING_TO_REPORT);
    }
    // The §4b section still has to be filled in on a quiet branch — "none" is a
    // valid answer that must still be stated. Handing over an unticked block is
    // the difference between the author answering it and the tool answering it
    // for them, which is what this whole change is about.
    out.push(
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
      `**${report.missingDocs.length} doc${report.missingDocs.length === 1 ? "" : "s"} / community skill${report.missingDocs.length === 1 ? "" : "s"} in scope, untouched by this branch:**`,
      "",
    );
    for (const d of report.missingDocs) {
      out.push(`- \`${d.path}\` — ${d.why}`);
    }
  } else if (report.docs.length === 0) {
    out.push(
      "⚠️ **No documented page or community skill maps to these changes.** That may be right, or a gap in the map (`scripts/surface/plan/obligations.mjs`) — worth checking §4's table before concluding there's nothing to write.",
    );
  } else {
    out.push(
      "✅ Every doc / community skill in scope was touched on this branch.",
    );
  }
  out.push("");

  out.push("<details><summary><b>Scenarios (§4b)</b></summary>", "");
  for (const s of report.scenarios) {
    let line = `- **${s.action}** — ${s.subject}${stampMarkdown(s.stamp)}  \n  ${s.note}`;
    if (s.ids.length) {
      // Same rule as the text renderer: never let "none updated" and "all
      // updated" produce the same line, and never present a retired row as
      // coverage.
      const outstanding = s.idsUntouched.length
        ? ` — ⚠️ still untouched: ${s.idsUntouched.map((i) => `\`${i}\``).join(", ")}`
        : " — ✅ all touched on this branch";
      const label = (i) =>
        s.deprecated?.includes(i) ? `\`${i}\` _(Deprecated)_` : `\`${i}\``;
      line += `  \n  Covered by ${s.ids.map(label).join(", ")}${outstanding}`;
      if (s.deprecated?.length && s.deprecated.length === s.ids.length) {
        line += `  \n  ⚠️ **Every row naming this is Deprecated** — a coverage gap, not coverage. \`pnpm surface:scenarios\` will fail on it.`;
      }
    }
    if (s.twins.length) {
      // Same rule as the ids above — a twin the branch already edited is done,
      // and saying so is the difference between a list people read and one they
      // learn to skip.
      const state = s.twinsUntouched.length
        ? ` ⚠️ still to check: ${s.twinsUntouched.map((i) => `\`${i}\``).join(", ")}`
        : " ✅ already touched on this branch";
      const many = s.twins.length > 1;
      line += `  \n  Twin${many ? "s" : ""} ${s.twins.map((i) => `\`${i}\``).join(", ")} assert${many ? "" : "s"} the same subject at the other altitude —${state}`;
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
