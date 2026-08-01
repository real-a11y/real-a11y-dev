// D2 — merge, don't overwrite.
//
// The generator owns a table's SKELETON: which rows exist, in what order. It
// does not own their prose. Every Purpose cell in commands.md differs from the
// manifest `summary` it nominally describes — all fourteen of them — because the
// docs say something better than the code's one-liner does:
//
//   summary : "One category: heading|link|button|form|landmark|image"
//   doc     : "One category — heading, link, button, form, landmark, image."
//
// Regenerating those would delete the difference. So an existing row is carried
// forward VERBATIM, a vanished row is dropped, and a new row lands as a stub
// with `TODO` — which `check` fails on, so the gap is loud and lands on a human
// rather than being quietly filled with something worse.
//
// What this buys is not generated prose. It is that a row cannot be MISSING, in
// the wrong group, or in the wrong order — which is the drift that actually
// happened.

/** A markdown table row → its cells, trimmed, without the outer pipes. */
function cellsOf(line) {
  const t = line.trim();
  if (!t.startsWith("|") || !t.endsWith("|")) return null;
  return t
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
}

/** Is this the `| --- | --- |` separator? */
function isSeparator(line) {
  const cells = cellsOf(line);
  return (
    !!cells && cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c))
  );
}

/**
 * Split a region body into its header lines and its data rows.
 *
 * Anything before the separator is header and is preserved untouched — the
 * column names are as much a human choice as the prose under them.
 */
export function parseTable(body) {
  const lines = body.split("\n");
  const sep = lines.findIndex(isSeparator);
  if (sep === -1) return null;

  // Rows run until the first line that isn't one; everything from there is TAIL
  // and is preserved verbatim.
  //
  // The tail is usually just the blank line before the closing marker, and
  // dropping it is not cosmetic: the body would come back one line shorter, the
  // splice would pull the rest of the document up, and every line after the
  // region would shift. That is what the first run of this did — a table that
  // rendered identically while silently eating the newline under it.
  let end = sep + 1;
  const rows = [];
  while (end < lines.length) {
    const cells = cellsOf(lines[end]);
    if (!cells) break;
    rows.push({ raw: lines[end], cells });
    end++;
  }

  return {
    head: lines.slice(0, sep + 1),
    rows,
    tail: lines.slice(end),
  };
}

/**
 * Rebuild a table's rows from the manifest, carrying prose forward.
 *
 * @param {object} o
 * @param {string} o.body       current region body
 * @param {string} o.where      region id, for messages
 * @param {string[]} o.keys     desired row keys, in the order they should appear
 * @param {(cells: string[]) => string|null} o.keyOfRow
 * @param {(key: string) => string} o.renderStub  a brand-new row, including TODO
 * @returns {{body: string, added: string[], removed: string[], problems: string[]}}
 */
export function mergeTable({ body, where, keys, keyOfRow, renderStub }) {
  const problems = [];
  const table = parseTable(body);
  if (!table) {
    return {
      body,
      added: [],
      removed: [],
      problems: [
        `${where} — no markdown table found inside the region. Expected a header ` +
          `row and a \`| --- |\` separator; the region markers may be around the ` +
          `wrong span.`,
      ],
    };
  }

  const existing = new Map();
  for (const row of table.rows) {
    const key = keyOfRow(row.cells);
    if (key === null) {
      problems.push(
        `${where} — could not read a row key from: ${row.raw.trim()}. Leaving the ` +
          `region alone rather than guessing, because a misread key drops the row.`,
      );
      return { body, added: [], removed: [], problems };
    }
    if (existing.has(key)) {
      problems.push(`${where} — two rows for \`${key}\`; remove one.`);
      return { body, added: [], removed: [], problems };
    }
    existing.set(key, row);
  }

  // EXISTING ORDER IS KEPT. New rows are appended; vanished rows are dropped.
  //
  // The plan's algorithm said "emit rows in manifest order", which assumed the
  // manifest's order meant something. It doesn't — `model.mjs` sorts commands
  // alphabetically so the committed JSON diffs stably, and that is the only
  // reason they are in that sequence. The docs order the same rows to teach:
  // Views leads with `tree` because it is the one people want, and Act leads
  // with `interact` because the single-verb commands are special cases of it.
  // Alphabetising would put `list` and `click` first and make both tables worse.
  //
  // So sequence is editorial, like the prose and the hand-truncated link text.
  // What is left for the generator to own is exactly one thing — whether a row
  // EXISTS — and that is the thing that actually drifted.
  const wanted = new Set(keys);
  const out = [];
  for (const row of table.rows) {
    if (wanted.has(keyOfRow(row.cells))) out.push(row.raw);
  }

  const added = keys.filter((k) => !existing.has(k));
  for (const key of added) out.push(renderStub(key));

  const removed = [...existing.keys()].filter((k) => !wanted.has(k));

  return {
    body: [...table.head, ...out, ...table.tail].join("\n"),
    added,
    removed,
    problems,
  };
}
