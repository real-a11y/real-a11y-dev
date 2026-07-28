// The one check that doesn't take `slugify()` on faith.
//
// Everything in `check/anchors.mjs` compares links against `slugify()`, and the
// heading anchors it validates them against come from `slugify()` too — so a
// clean run proves the docs and this repo's slug function agree with each other,
// not that either agrees with VitePress. The slug function is the risk surface:
// if it drifts from `@mdit-vue/shared` (a VitePress bump changes a rule, say),
// the anchor check keeps passing while validating anchors the site never emits.
//
// This closes that loop against the built site: every `id` VitePress actually
// put on a heading in `website/.vitepress/dist` has to be one `slugify()`
// produces from that page's source headings. It needs a build, so it runs in the
// `website-a11y` job, which builds the site anyway.

import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { headings } from "./markdown.mjs";

const DIST = "website/.vitepress/dist";
/** Hashed chunks, not pages. */
const SKIP_DIRS = new Set(["assets"]);

const HEADING_ID = /<h[1-6][^>]*\bid="([^"]+)"/g;

async function* htmlFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* htmlFiles(full);
    } else if (entry.name.endsWith(".html")) {
      yield full;
    }
  }
}

/** The page a built route came from: `packages/mcp.html` → `website/packages/mcp.md`. */
function pageSource(distRoot, html) {
  const route = relative(distRoot, html)
    .split(sep)
    .join("/")
    .replace(/\.html$/, "");
  return `website/${route}.md`;
}

/**
 * Compare the ids VitePress emitted with the ids `slugify()` computes.
 *
 * Returns `{ problems, pages, ids }` — the counts are reported on success for
 * the same reason the sample check reports its own: a comparison that quietly
 * stops finding pages would pass forever.
 */
export async function checkBuiltAnchors(repoRoot) {
  const distRoot = join(repoRoot, DIST);
  const problems = [];
  let pages = 0;
  let ids = 0;

  for await (const html of htmlFiles(distRoot)) {
    const source = pageSource(distRoot, html);
    let text;
    try {
      text = await readFile(join(repoRoot, source), "utf8");
    } catch {
      continue; // a generated page (404) with no markdown behind it
    }
    pages++;

    const computed = new Set(headings(text).map((h) => h.anchor));
    for (const [, id] of (await readFile(html, "utf8")).matchAll(HEADING_ID)) {
      ids++;
      // VitePress suffixes a repeat with -1, -2 …; checkDuplicateAnchors is
      // what has an opinion about those.
      if (computed.has(id) || computed.has(id.replace(/-\d+$/, ""))) continue;
      problems.push({
        where: source,
        message: `the built site gives a heading id #${id}, which slugify() produces from no heading here — the slug function and VitePress disagree`,
      });
    }
  }

  return { problems, pages, ids };
}

export { DIST };
