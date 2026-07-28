// Reading the docs as structure: which files make live claims, and the fenced
// blocks and headings inside them.
//
// "Live" is the load-bearing word. A CHANGELOG entry describing what
// 0.1.0-beta.1 did is a historical record — it SHOULD still name a flag that
// has since been removed, and a check that failed on it would be wrong and
// would push someone to rewrite history to get CI green. Same for the pending
// `.changeset/` entries. Only documents that describe the software as it is
// today are in scope.

import { readdir, readFile } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";

/** Top-level places that hold documentation about the current software. */
const ROOTS = ["website", "packages", "docs"];
/** Root-level files in scope; every other root `.md` is policy or history. */
const ROOT_FILES = ["README.md", "CONTRIBUTING.md"];

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "cache",
  "storybook-static",
  "test-results",
  "playwright-report",
]);

/** Historical by nature — see the header. */
function isHistorical(relPath) {
  return relPath.endsWith("CHANGELOG.md") || relPath.startsWith(".changeset/");
}

async function* walk(dir) {
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
      yield* walk(full);
    } else if (entry.name.endsWith(".md")) {
      yield full;
    }
  }
}

/**
 * Every doc that has to be true right now, as repo-relative POSIX paths so a
 * failure reads the same on Windows as it does in CI.
 */
export async function docFiles(repoRoot) {
  const found = [];
  for (const root of ROOTS) {
    for await (const file of walk(join(repoRoot, root))) {
      found.push(relative(repoRoot, file).split(sep).join(posix.sep));
    }
  }
  for (const name of ROOT_FILES) found.push(name);
  return found.filter((p) => !isHistorical(p)).sort();
}

export async function readDoc(repoRoot, relPath) {
  return readFile(join(repoRoot, relPath), "utf8");
}

/**
 * Fenced code blocks, with the 1-based line number of each body line so a
 * failure can point at the offending line rather than the block.
 *
 * Tracks the opening fence's length and only closes on a fence at least as
 * long — the docs use ````text blocks that contain ``` inside them, and a
 * naive scanner reads the inner fence as the end and the rest of the file as
 * code.
 */
export function fencedBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  let open = null;

  for (let i = 0; i < lines.length; i++) {
    const fence = /^(`{3,})(.*)$/.exec(lines[i]);
    if (!open) {
      if (fence) {
        open = { ticks: fence[1], info: fence[2].trim(), start: i, body: [] };
      }
      continue;
    }
    if (fence && fence[1].length >= open.ticks.length && !fence[2].trim()) {
      blocks.push({
        // "sh [npm]" and "ts [Vite / React]" both appear — the language is the
        // first word, the rest is VitePress tab labelling.
        lang: open.info.split(/[\s[]/)[0].toLowerCase(),
        info: open.info,
        lines: open.body,
        startLine: open.start + 1,
      });
      open = null;
      continue;
    }
    open.body.push({ text: lines[i], line: i + 1 });
  }
  return blocks;
}

/**
 * ATX headings outside code fences. Inside a fence a `# comment` in a shell
 * sample is not a heading, and counting it as one invents anchors that don't
 * exist.
 */
export function headings(text) {
  const lines = text.split("\n");
  const found = [];
  let fence = null;

  for (let i = 0; i < lines.length; i++) {
    const f = /^(`{3,})/.exec(lines[i]);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const h = /^(#{1,6})\s+(.*?)\s*$/.exec(lines[i]);
    if (h) {
      found.push({
        depth: h[1].length,
        text: h[2],
        line: i + 1,
        anchor: slugify(h[2]),
      });
    }
  }
  return found;
}

/**
 * The anchor VitePress gives a heading.
 *
 * This mirrors `@mdit-vue/shared`'s `slugify`, which VitePress hands to
 * markdown-it-anchor — deliberately, character for character, because guessing
 * it is how you build a link checker that reports failures that aren't real.
 * Three of its rules are not what you would invent:
 *
 * - only the listed ASCII punctuation becomes a dash. An em dash, a middle dot
 *   and an arrow all survive into the id verbatim, so
 *   `Keyboard bar — \`Esc\` · \`Tab\`` really is
 *   `#keyboard-bar-—-esc-·-tab`.
 * - a leading digit gets an `_` prefix: `1. Save the session` is
 *   `#_1-save-the-session`, not `#1-save-the-session`.
 * - lowercasing happens LAST, after the substitutions.
 *
 * Every rule here was verified against the ids in `website/.vitepress/dist`
 * rather than from memory: all 561 headings in the site agree.
 */
export function slugify(headingText) {
  return (
    stripHtml(headingText)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f]/g, "")
      .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^(\d)/, "_$1")
      .toLowerCase()
  );
}

/**
 * Inline HTML contributes no text to the slug — `<a id="x"></a>Next.js` is
 * `next-js`. The tag still defines its own anchor; see {@link explicitAnchors}.
 *
 * Only OUTSIDE a code span. Inside one, `<url>` is literal text and does count:
 * the command reference's `` `audit <url...>` `` is `#audit-url`, and stripping
 * it as a tag collapses eleven command headings onto bare `#audit`, `#tree`,
 * `#diff` — which look plausible enough to ship a link checker that quietly
 * validates the wrong anchors.
 */
function stripHtml(text) {
  return text
    .split(/(`+[^`]*`+)/)
    .map((part) =>
      part.startsWith("`")
        ? part
        : part
            // Split on markdown-it's inline-HTML grammar — an open or close
            // tag, or a comment — and keep only the text between the matches.
            // Deliberately narrower than "anything between angle brackets": a
            // stray `<` in prose is text, and markdown-it treats it as such.
            //
            // Splitting rather than replacing with "" is the same single pass
            // over the input, expressed as what it is: extracting the text
            // markdown-it would render, not sanitizing hostile HTML. A
            // multi-character `replace` here reads as the latter, and reads
            // wrong — one pass can stitch a new tag out of the remains of two
            // (`<scrip<b>t>` → `<script>`), which is a real bug in a sanitizer
            // and merely markdown-it's behavior in a slug function.
            .split(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>|<!--[\s\S]*?-->/)
            .join("")
            // Then drop any angle bracket left over, character by character, so
            // this can never hand back something that still looks like part of
            // a tag. `<` and `>` are both in the slug's punctuation class
            // below, so removing them here or letting them become dashes
            // produces the same slug either way.
            .replace(/[<>]/g, ""),
    )
    .join("");
}

/**
 * Anchors written by hand as HTML, e.g. `<a id="template-nextjs"></a>`.
 *
 * The CI guide uses these to give its workflow templates stable link targets
 * independent of the heading wording. They are real anchors on the page, so a
 * link checker that only knows about headings calls them dead.
 */
export function explicitAnchors(text) {
  return [...text.matchAll(/<[a-z][^>]*\sid=["']([^"']+)["']/gi)].map(
    (m) => m[1],
  );
}
