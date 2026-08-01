// One computation, two verbs — D4.
//
// `apply` writes the result; `check` compares against it and writes nothing. They
// share this function so they cannot disagree about what "current" means, which
// is the same reason `plan`'s two renderers share `buildReport`. A drift check
// that computed its expectation separately from the writer would eventually
// fail on something `apply` couldn't fix.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { cliRegions, COMMANDS_FILE } from "./cli.mjs";
import { readRegions, writeRegions } from "./regions.mjs";

/** Which files carry regions, and what rebuilds each region in them. */
function plan(manifest) {
  return new Map([[COMMANDS_FILE, cliRegions(manifest)]]);
}

/**
 * Recompute every managed region.
 *
 * @param {string} repoRoot
 * @param {object} manifest
 * @returns {Promise<{files: {path: string, text: string, current: string, changed: string[]}[], added: string[], removed: string[], problems: {where: string, message: string}[]}>}
 */
export async function renderAll(repoRoot, manifest) {
  const files = [];
  const problems = [];
  const added = [];
  const removed = [];
  const moved = [];

  for (const [relPath, builders] of plan(manifest)) {
    const current = await readFile(join(repoRoot, relPath), "utf8");
    const { regions, problems: markerProblems } = readRegions(current, relPath);
    for (const message of markerProblems)
      problems.push({ where: relPath, message });
    if (markerProblems.length) continue;

    // Two passes, because a MOVE is only visible from the file.
    //
    // Each region merges in isolation, so when a command's `group` changes, the
    // region losing it sees a removal and the region gaining it sees something
    // brand new. Neither can tell those are one event — and treating them as two
    // destroys the hand-written Purpose cell that the whole merge exists to
    // protect, then reports it as "the surface is gone" when it plainly isn't.
    //
    // This seam is a consequence of splitting the command index into one region
    // per group. That split is still right (it puts the prose-carrying group
    // headings outside the markers entirely), but it has to be paid for here.
    const first = runBuilders(builders, regions, relPath);
    problems.push(...first.problems);

    // Scoped to THIS file. A move is a row leaving one region of a document and
    // arriving in another region of the same document; two files that happen to
    // share a row key have nothing to do with each other. Tracking it globally
    // is inert while `plan()` returns one file, and stops being inert the moment
    // `mcp-tool-index` lands in tools.md — a key moving here would then suppress
    // a legitimate "added" over there.
    const rescued = new Map();
    const movedHere = [];
    for (const [id, result] of first.results) {
      for (const [key, raw] of result.removedRows) {
        const landsIn = [...first.results].find(
          ([otherId, other]) => otherId !== id && other.added.includes(key),
        );
        if (landsIn) {
          rescued.set(key, raw);
          movedHere.push({ file: relPath, key, from: id, to: landsIn[0] });
        }
      }
    }
    moved.push(...movedHere);

    const final = rescued.size
      ? runBuilders(builders, regions, relPath, rescued)
      : first;

    const bodies = {};
    const isMove = (key) => movedHere.some((m) => m.key === key);
    for (const [id, result] of final.results) {
      bodies[id] = result.body;
      added.push(
        ...result.added.filter((k) => !isMove(k)).map((k) => `${id}: ${k}`),
      );
      removed.push(
        ...result.removed.filter((k) => !isMove(k)).map((k) => `${id}: ${k}`),
      );
    }

    const { text, changed } = writeRegions(current, regions, bodies);
    files.push({ path: relPath, text, current, changed });
  }

  return { files, added, removed, moved, problems };
}

/** Run every builder for one file. Split out so the move pass can repeat it. */
function runBuilders(builders, regions, relPath, carry) {
  const results = new Map();
  const problems = [];

  for (const [id, build] of builders) {
    const region = regions.get(id);
    // A region the code knows about but the file doesn't have is a real
    // failure, not a no-op: it means that table stopped being managed and
    // nothing would ever say so again.
    if (!region) {
      problems.push({
        where: relPath,
        message:
          `no \`surface:begin ${id}\` / \`surface:end ${id}\` markers. That ` +
          `region is generated, so without them the block silently stops being ` +
          `maintained. Re-add the markers around it, or drop the region from ` +
          `scripts/surface/render/.`,
      });
      continue;
    }
    const result = build(region.body, id, carry);
    for (const message of result.problems)
      problems.push({ where: relPath, message });
    if (result.problems.length) continue;
    results.set(id, result);
  }

  return { results, problems };
}

/** `apply` — the only verb that writes. */
export async function applyAll(repoRoot, manifest) {
  const result = await renderAll(repoRoot, manifest);
  if (result.problems.length) return { ...result, written: [] };

  const written = [];
  for (const file of result.files) {
    if (file.text === file.current) continue;
    await writeFile(join(repoRoot, file.path), file.text, "utf8");
    written.push({ path: file.path, regions: file.changed });
  }
  return { ...result, written };
}

/**
 * `check` — read-only drift detection.
 *
 * Returns the same `{where, message}` shape as every other check so it drops
 * straight into the existing problem list.
 */
export async function checkDrift(repoRoot, manifest) {
  const result = await renderAll(repoRoot, manifest);
  const problems = [...result.problems];

  for (const file of result.files) {
    if (file.text === file.current) continue;
    problems.push({
      where: file.path,
      message:
        `managed region${file.changed.length > 1 ? "s" : ""} ` +
        `${file.changed.map((r) => `\`${r}\``).join(", ")} ` +
        `${file.changed.length > 1 ? "are" : "is"} out of date with ` +
        `docs/surface.json.\n    Regenerate and commit the result:\n\n      pnpm surface:apply`,
    });
  }

  // A stub is a marker that a human still owes prose, so failing on it is the
  // point of writing TODO rather than inventing a sentence.
  //
  // Scanned against what is ON DISK, not against what we just rendered. The
  // rendered text contains a fresh stub for every new row, so reading it made
  // the first `check` after adding a command emit two failures: a true one
  // ("out of date") and a false one ("this page contains a TODO") about a
  // placeholder no file contained yet. A wrong message beside a right one is
  // worse than no message — it sends someone hunting through the page for it.
  for (const file of result.files) {
    const { regions } = readRegions(file.current, file.path);
    for (const [id, region] of regions) {
      if (!region.body.includes("TODO")) continue;
      problems.push({
        where: file.path,
        message:
          `region \`${id}\` contains \`TODO\` — a row was generated for a surface ` +
          `that had none, and its prose is still unwritten. The generator does not ` +
          `write prose (see render/table.mjs); this one is yours.`,
      });
    }
  }

  return problems;
}
