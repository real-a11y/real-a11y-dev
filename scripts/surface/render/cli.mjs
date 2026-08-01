// The CLI regions: the grouped command tables, and the exit-code table.
//
// ONE REGION PER GROUP rather than one around the whole "at a glance" section.
// The plan called for a single `cli-command-index`, and narrowing it is a better
// fit for the same plan's own rule that a region over ~40 lines is the wrong
// region. Two things fall out of the split, both of which delete code:
//
//   - The group headings — `**Audit** — the gates: these exit \`1\` on findings
//     at or above [--fail-on](#fail-on-level).` — sit OUTSIDE the markers, so
//     they cannot be touched. No carry-forward logic, no way to lose them.
//   - A new group is a human action: add the block, add the markers. Group order
//     and naming are editorial (`view` in the manifest, "Views" in the docs, and
//     the doc order is Setup→Audit→Views→Act→Artifacts, which is not the
//     manifest's), so a generator inventing them would be guessing at prose.
//
// The count sentence ("Fourteen commands ship — …") is deliberately NOT
// generated. `checkDocs` already fails when that number is wrong, and the number
// is welded into a sentence with hand-written clauses on both sides — generating
// it would be the over-generation this whole design is arranged to avoid, in
// exchange for a guard that already exists.

import { slugify } from "../check/markdown.mjs";

import { mergeTable } from "./table.mjs";

export const COMMANDS_FILE = "website/packages/cli/commands.md";

/** Manifest group key → region id. The doc's label text stays outside. */
const GROUP_REGION = (group) => `cli-commands-${group}`;

/**
 * The first cell is a link whose text opens with the command name:
 *   | [`list <category> <url>`](#list-category-url) | One category — … |
 * Everything after that first token is the hand-truncated usage, which is prose.
 */
function commandKey(cells) {
  const m = /^\[`([^\s`]+)/.exec(cells[0] ?? "");
  return m ? m[1] : null;
}

/**
 * A brand-new command's row.
 *
 * The link text starts from the manifest usage minus the ` [flags]` tail, which
 * is right for 10 of the 14 commands today. The other four are hand-truncated —
 * `type` drops `--name "<name>"` from the middle — so this is a starting point
 * the author edits, not an answer. `TODO` in the prose cell is what makes that
 * unavoidable: `check` fails until someone writes it.
 */
function commandStub(command) {
  const label = command.usage.replace(/\s*\[flags\]\s*$/, "");
  return `| [\`${label}\`](#${slugify("`" + label + "`")}) | TODO |`;
}

function exitCodeKey(cells) {
  const m = /^`(\d+)`$/.exec(cells[0] ?? "");
  return m ? m[1] : null;
}

/**
 * Every CLI region and how to rebuild it.
 *
 * @param {object} manifest
 * @returns {Map<string, (body: string, id: string) => ReturnType<typeof mergeTable>>}
 */
export function cliRegions(manifest) {
  const builders = new Map();

  // One table per group, rows in the order the manifest lists the commands.
  const groups = [...new Set(manifest.cli.commands.map((c) => c.group))];
  for (const group of groups) {
    const inGroup = manifest.cli.commands.filter((c) => c.group === group);
    builders.set(GROUP_REGION(group), (body, where, carry) =>
      mergeTable({
        body,
        where,
        carry,
        keys: inGroup.map((c) => c.name),
        keyOfRow: commandKey,
        renderStub: (name) => commandStub(inGroup.find((c) => c.name === name)),
      }),
    );
  }

  // Exit codes. The Meaning column is prose — the manifest carries only the
  // number and an internal name (`OK`, `FINDINGS`, `ERROR`), and "Clean — no
  // findings at or above [--fail-on](#fail-on-level)." says considerably more
  // than `OK` does. So this region guards that the three codes are all present
  // and in order, which is what a frozen contract needs.
  builders.set("cli-exit-codes", (body, where, carry) =>
    mergeTable({
      body,
      where,
      carry,
      keys: manifest.cli.exitCodes.map((e) => String(e.code)),
      keyOfRow: exitCodeKey,
      renderStub: (code) => `| \`${code}\` | TODO |`,
    }),
  );

  return builders;
}
