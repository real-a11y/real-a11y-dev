// The MCP tool index — one region per group in `tools.md`.
//
// Same shape as the CLI command index, with one structural difference that
// changes what the generator is allowed to do: **the manifest has no group for a
// tool.** A CLI command carries `group` (Phase 1 added it to `CommandSpec`), so
// a new command can be placed. An MCP tool carries `name`, `title`,
// `description`, `inputSchema` and `annotations` — and nothing about where it
// belongs in the docs.
//
// That grouping is real editorial work. Someone decided `focus_element` belongs
// under **Act** rather than **Views**, and that checkpoints split into
// "Findings" and "Tree" — a distinction the tools themselves don't announce and
// which exists because the two behave differently under navigation. A generator
// inventing a taxonomy would be writing docs, not checking them.
//
// So placement is NOT generated. What each region owns is narrower:
//
//   - a tool that no longer ships is dropped from whichever region held it;
//   - the surviving rows keep their order and their prose;
//   - and a FILE-level check (below) fails when a shipped tool has no row
//     anywhere, or has one in two places.
//
// A new tool therefore fails the build with its name and the list of groups to
// choose from, rather than being auto-filed into a group someone would then have
// to notice was wrong. Which group it belongs in is a judgement; that it must
// appear somewhere is a fact.

import { readRegions } from "./regions.mjs";
import { mergeTable, parseTable } from "./table.mjs";

export const TOOLS_FILE = "website/packages/mcp/tools.md";

/** `| [\`open_page\`](#open-page) | … |` → `open_page`. */
function toolKey(cells) {
  const m = /^\[`([a-z_]+)`\]/.exec(cells[0] ?? "");
  return m ? m[1] : null;
}

/**
 * Region ids, in the order the doc lays them out.
 *
 * Hard-coded rather than derived, because there is nothing to derive them from —
 * see the header. Adding a group here without adding the markers (or vice versa)
 * is caught by the two symmetric guards in ./index.mjs.
 */
export const TOOL_REGIONS = [
  "mcp-tools-session",
  "mcp-tools-audit",
  "mcp-tools-views",
  "mcp-tools-findings-checkpoints",
  "mcp-tools-tree-checkpoints",
  "mcp-tools-act",
];

export function mcpRegions(manifest) {
  const shipped = new Set(manifest.mcp.tools.map((t) => t.name));
  const builders = new Map();

  for (const id of TOOL_REGIONS) {
    builders.set(id, (body, where, carry) => {
      const rows = readKeys(body);
      return mergeTable({
        body,
        where,
        carry,
        // The region keeps exactly the tools its TABLE already lists that still
        // ship. Nothing is added here — see the header on why placement is a
        // human call — so `keys` is a subset of what the merge already parsed
        // and `renderStub` should never fire.
        //
        // "Should", not "cannot". It fired once: `readKeys` used to scan the
        // whole region body while the merge only reads the contiguous table, so
        // a row added below the table went into `keys` without being in
        // `existing`. Both now read through `parseTable`, and a stranded row is
        // reported by `checkToolPlacement` instead. The throw stays as an
        // assertion — if it ever fires again the invariant broke and a stack
        // trace is the honest answer, but the path a person can actually take
        // now ends in a message.
        keys: rows.filter((k) => shipped.has(k)),
        keyOfRow: toolKey,
        renderStub: (key) => {
          throw new Error(
            `mcp: refusing to invent a row for \`${key}\` — the manifest carries ` +
              `no group for a tool, so which table it belongs in is editorial. ` +
              `checkToolPlacement reports it instead.`,
          );
        },
      });
    });
  }

  return builders;
}

/**
 * Row keys in a region's TABLE, in order.
 *
 * Reads through `parseTable` rather than scanning every line, so this and the
 * merge agree about what counts as a row. They didn't: this used to match any
 * pipe-delimited line in the body, while `parseTable` stops at the first
 * non-row line and files the rest as `tail`. A row added below the table with a
 * blank line between it and the rows — the obvious way to follow "add it to
 * whichever group fits" — was therefore *wanted* but not *existing*, which drove
 * the merge into the `renderStub` that throws.
 *
 * So "unreachable by construction" was wrong, and reachable by exactly the
 * action the error message asks for. One parser, one answer.
 */
function readKeys(body) {
  const table = parseTable(body);
  if (!table) return [];
  return table.rows.map((r) => toolKey(r.cells)).filter((k) => k !== null);
}

/**
 * Tool rows stranded outside the table — in the region, but after the blank line
 * that ends it. Detached from the rows above, so neither the merge nor the
 * placement check can see them, and markdown won't render them as table rows
 * either. Worth its own message: the row IS there, and being told "no row in the
 * index" while looking straight at one is its own kind of wrong.
 */
function strandedRows(body) {
  const table = parseTable(body);
  if (!table) return [];
  return table.tail
    .map((line) => {
      const t = line.trim();
      if (!t.startsWith("|") || !t.endsWith("|")) return null;
      return toolKey(
        t
          .slice(1, -1)
          .split("|")
          .map((c) => c.trim()),
      );
    })
    .filter((k) => k !== null);
}

/**
 * Every shipped tool has a row, in exactly one group.
 *
 * This is the half that replaces stub generation. `checkCoverage` already
 * asserts a tool is *mentioned* somewhere in the reference; this asserts it is
 * in the at-a-glance index, which is the table people actually scan and the one
 * that silently fell behind when the act tools landed.
 *
 * @returns {{where: string, message: string}[]}
 */
export function checkToolPlacement(manifest, text, relPath) {
  const { regions } = readRegions(text, relPath);

  const placed = new Map(); // tool → [region ids]
  const stranded = new Set(); // has a row, but not one that counts
  const problems = [];

  for (const id of TOOL_REGIONS) {
    const region = regions.get(id);
    if (!region) continue;
    for (const key of readKeys(region.body)) {
      placed.set(key, [...(placed.get(key) ?? []), id]);
    }
    for (const key of strandedRows(region.body)) {
      stranded.add(key);
      problems.push({
        where: relPath,
        message:
          `\`${key}\` has a row in \`${id}\` but it sits below the table, past a ` +
          `blank line. Markdown won't render it as a row and the tooling can't ` +
          `see it either.\n    Move it up so it is contiguous with the rows above.`,
      });
    }
  }

  for (const tool of manifest.mcp.tools) {
    const where = placed.get(tool.name);
    // A stranded row already got the precise message. Adding "ships but has no
    // row" on top would read as a contradiction to someone looking straight at
    // the row they just wrote — two messages, one cause, and the vaguer one
    // second.
    if (!where && stranded.has(tool.name)) continue;
    if (!where) {
      problems.push({
        where: relPath,
        message:
          `\`${tool.name}\` ships but has no row in the at-a-glance index. Add it ` +
          `to whichever group fits — ${TOOL_REGIONS.map((r) => r.replace("mcp-tools-", "")).join(", ")} ` +
          `— along with a one-line Purpose.\n    Not placed automatically: the ` +
          `manifest carries no group for a tool, so the taxonomy is yours. The ` +
          `index is the table people scan, and it is the one that fell behind ` +
          `when the act tools shipped.`,
      });
    } else {
      // Distinct GROUPS, not row count. Two rows for one tool inside a single
      // table pushed the same region id twice and reported "listed in 2 groups
      // (mcp-tools-act, mcp-tools-act)" — a second group that does not exist,
      // sending someone to look for it.
      //
      // That case is already reported accurately by `mergeTable` ("two rows for
      // `type_text`; remove one"), so it falls through to that rather than being
      // described twice, once wrongly. Same rule as the stranded row above: one
      // cause, one message, and the precise one wins.
      const groups = [...new Set(where)];
      if (groups.length > 1) {
        problems.push({
          where: relPath,
          message:
            `\`${tool.name}\` is listed in ${groups.length} groups ` +
            `(${groups.join(", ")}). One row per tool, or the count stops ` +
            `meaning anything.`,
        });
      }
    }
  }

  return problems;
}
