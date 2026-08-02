// Managed regions — the reader/writer half of D3.
//
// No file is "generated". A narrow marked span inside a hand-written page is:
//
//   <!-- surface:begin cli-exit-codes -->
//   … generated …
//   <!-- surface:end cli-exit-codes -->
//
// Everything outside the markers is returned byte-for-byte. That is the whole
// contract, and it is what makes the tool survivable: a generator that rewrites
// a hand-tuned page produces a 200-line diff, loses the voice, and gets turned
// off within a month.
//
// Every malformed-marker case is an ERROR rather than a best guess. A region
// that silently fails to parse would be a region that silently stops being
// generated — the docs would drift exactly as before while a passing check said
// otherwise. That failure is invisible; the loud one is not.

const BEGIN = /^<!--\s*surface:begin\s+([a-z0-9-]+)\s*-->$/;
const END = /^<!--\s*surface:end\s+([a-z0-9-]+)\s*-->$/;

/**
 * Regions that NAME surface without DOCUMENTING it.
 *
 * `cli-unreleased` lists the commands and flags a release does not yet ship, as
 * code spans, because that is how they read. But the doc gates count a code
 * span as proof: `mentionedFlags` in check/coverage.mjs treats any `--flag`
 * inside one as documented, and `documentedAs` in check/docs.mjs matches a
 * backtick followed by a command name. So the notice would satisfy the very
 * checks that are supposed to catch an undocumented capability — a brand-new
 * flag could ship with no prose at all, and the only page "documenting" it
 * would be the one saying you cannot install it yet.
 *
 * That is worse than no check. It is a green gate asserting the docs are
 * complete, caused by the tool that exists to tell the truth about them.
 *
 * The merged regions are NOT here and must not be: the command tables carry
 * hand-written Purpose cells and are real documentation. The distinction is
 * whether a human wrote the prose, which is the same line ./table.mjs draws.
 */
export const NON_DOCUMENTING = new Set(["cli-unreleased"]);

/**
 * The document with every non-documenting region's body removed.
 *
 * Markers are left in place so line-based errors elsewhere stay meaningful; only
 * the generated body between them goes. Callers that ASK about documentation
 * coverage use this; callers that ask about structure (anchors, drift) read the
 * real file.
 *
 * @param {string} text
 * @returns {string}
 */
export function withoutGeneratedClaims(text) {
  const { regions } = readRegions(text, "<coverage scan>");
  const drop = new Set();
  for (const [id, region] of regions) {
    if (!NON_DOCUMENTING.has(id)) continue;
    for (let i = region.beginLine + 1; i < region.endLine; i++) drop.add(i);
  }
  if (drop.size === 0) return text;
  return text
    .split("\n")
    .filter((_, i) => !drop.has(i))
    .join("\n");
}

/**
 * @typedef {object} Region
 * @property {string} id
 * @property {number} beginLine  index of the begin marker
 * @property {number} endLine    index of the end marker
 * @property {string} body       content between the markers, no trailing newline
 */

/**
 * Locate every managed region in a document.
 *
 * @param {string} text
 * @param {string} where  file path, for error messages
 * @returns {{regions: Map<string, Region>, problems: string[]}}
 */
export function readRegions(text, where) {
  const lines = text.split("\n");
  const regions = new Map();
  const problems = [];

  let open = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    const begin = BEGIN.exec(line);
    if (begin) {
      const id = begin[1];
      if (open) {
        problems.push(
          `${where}:${i + 1} — \`surface:begin ${id}\` while \`${open.id}\` is ` +
            `still open (began at line ${open.beginLine + 1}). Regions cannot nest.`,
        );
        continue;
      }
      if (regions.has(id)) {
        problems.push(
          `${where}:${i + 1} — a second region called \`${id}\`; the first is at ` +
            `line ${regions.get(id).beginLine + 1}. Ids must be unique per file, ` +
            `or a write would land in whichever one happened to parse last.`,
        );
        continue;
      }
      open = { id, beginLine: i };
      continue;
    }

    const end = END.exec(line);
    if (end) {
      const id = end[1];
      if (!open) {
        problems.push(
          `${where}:${i + 1} — \`surface:end ${id}\` with no matching begin.`,
        );
        continue;
      }
      if (open.id !== id) {
        problems.push(
          `${where}:${i + 1} — \`surface:end ${id}\` closes \`${open.id}\`, which ` +
            `began at line ${open.beginLine + 1}. Mismatched markers.`,
        );
        open = null;
        continue;
      }
      regions.set(id, {
        id,
        beginLine: open.beginLine,
        endLine: i,
        body: lines.slice(open.beginLine + 1, i).join("\n"),
      });
      open = null;
    }
  }

  if (open) {
    problems.push(
      `${where}:${open.beginLine + 1} — \`surface:begin ${open.id}\` is never ` +
        `closed. Everything after it would be swallowed by the next write.`,
    );
  }

  return { regions, problems };
}

/**
 * Replace one region's body, leaving every other byte alone.
 *
 * Returns the text unchanged (and says so) when the body already matches — the
 * caller uses that to distinguish "wrote" from "already current", which is what
 * lets `check` be read-only and `apply` be quiet about no-ops.
 *
 * @returns {{text: string, changed: boolean}}
 */
export function writeRegion(text, region, body) {
  if (region.body === body) return { text, changed: false };

  const lines = text.split("\n");
  const next = [
    ...lines.slice(0, region.beginLine + 1),
    ...(body === "" ? [] : body.split("\n")),
    ...lines.slice(region.endLine),
  ];
  return { text: next.join("\n"), changed: true };
}

/**
 * Apply several region bodies to one document, in one pass.
 *
 * Rewrites bottom-up so each splice can't invalidate the line numbers of the
 * regions above it — the ordinary off-by-N that turns a multi-region write into
 * a corrupted file.
 *
 * @param {string} text
 * @param {Map<string, Region>} regions
 * @param {Record<string, string>} bodies  region id → desired body
 * @returns {{text: string, changed: string[]}}
 */
export function writeRegions(text, regions, bodies) {
  const targets = Object.keys(bodies)
    .map((id) => regions.get(id))
    .filter(Boolean)
    .sort((a, b) => b.beginLine - a.beginLine);

  let out = text;
  const changed = [];
  for (const region of targets) {
    const result = writeRegion(out, region, bodies[region.id]);
    out = result.text;
    if (result.changed) changed.push(region.id);
  }
  return { text: out, changed: changed.reverse() };
}
