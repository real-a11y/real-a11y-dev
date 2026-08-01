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
import { mergeTable } from "./table.mjs";

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
        // The region keeps exactly the tools it already lists that still ship.
        // Nothing is added here — see the header on why placement is a human
        // call — so `keys` never contains something `existing` lacks and
        // `renderStub` is unreachable by construction. It throws rather than
        // returning a plausible row, so a future change that does start adding
        // here has to decide the taxonomy question deliberately.
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

/** Row keys currently in a region body, in order. */
function readKeys(body) {
  return body
    .split("\n")
    .map((l) => {
      const t = l.trim();
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
  for (const id of TOOL_REGIONS) {
    const region = regions.get(id);
    if (!region) continue;
    for (const key of readKeys(region.body)) {
      placed.set(key, [...(placed.get(key) ?? []), id]);
    }
  }

  const problems = [];
  for (const tool of manifest.mcp.tools) {
    const where = placed.get(tool.name);
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
    } else if (where.length > 1) {
      problems.push({
        where: relPath,
        message:
          `\`${tool.name}\` is listed in ${where.length} groups (${where.join(", ")}). ` +
          `One row per tool, or the count stops meaning anything.`,
      });
    }
  }

  return problems;
}
