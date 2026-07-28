// Every `#fragment` a doc links to must be a heading that exists.
//
// The VitePress build already fails on a dead *route* — a link to
// `/guide/nowhere`. It says nothing about the fragment: `/guide/why#the-part-i-
// renamed` builds clean and lands the reader at the top of the page with no
// indication anything was missed. The command reference is one 1000-line page
// held together by ~200 intra-page links, so this is the failure mode it is
// most exposed to.

import {
  docFiles,
  explicitAnchors,
  headings,
  readDoc,
  slugify,
} from "./markdown.mjs";

/** Inline `](…)` targets, plus `[ref]: …` definitions. */
const INLINE_LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const REF_LINK = /^\s*\[[^\]]+\]:\s*(\S+)/gm;

/**
 * A VitePress route → the file that serves it. `/guide/why` is
 * `website/guide/why.md`, `/` is `website/index.md`, and a trailing slash is a
 * directory index.
 */
function routeToFile(route) {
  const path = route.replace(/\.html$/, "");
  if (path === "/") return "website/index.md";
  if (path.endsWith("/")) return `website${path}index.md`;
  return `website${path}.md`;
}

export async function checkAnchors(repoRoot) {
  const problems = [];
  const files = await docFiles(repoRoot);

  // Anchors first: a cross-file link needs the target's headings, which may be
  // a file we haven't reached yet.
  const anchorsByFile = new Map();
  const texts = new Map();
  for (const file of files) {
    const text = await readDoc(repoRoot, file);
    texts.set(file, text);
    anchorsByFile.set(
      file,
      new Set([
        ...headings(text).map((h) => h.anchor),
        ...explicitAnchors(text),
      ]),
    );
  }

  for (const file of files) {
    const text = texts.get(file);
    const targets = [
      ...[...text.matchAll(INLINE_LINK)].map((m) => m[1]),
      ...[...text.matchAll(REF_LINK)].map((m) => m[1]),
    ];

    for (const target of targets) {
      const hash = target.indexOf("#");
      if (hash === -1) continue;
      const route = target.slice(0, hash);
      const fragment = decodeURIComponent(target.slice(hash + 1));
      if (!fragment) continue;

      // Same page.
      if (route === "") {
        if (!anchorsByFile.get(file).has(fragment)) {
          problems.push({
            where: file,
            message: `links to #${fragment}, which no heading in this file produces`,
          });
        }
        continue;
      }

      // Another page in the site. Only absolute routes are resolved: a relative
      // link out of a README can point anywhere, and guessing wrong would
      // report a failure that isn't one.
      if (!route.startsWith("/") || !file.startsWith("website/")) continue;
      const targetFile = routeToFile(route);
      const anchors = anchorsByFile.get(targetFile);
      // A missing target file is the VitePress build's job, not ours.
      if (!anchors) continue;
      if (!anchors.has(fragment)) {
        problems.push({
          where: file,
          message: `links to ${route}#${fragment}, but ${targetFile} has no such heading`,
        });
      }
    }
  }

  return problems;
}

/**
 * A heading whose anchor collides with an earlier one on the same page.
 *
 * VitePress disambiguates the second with a numeric suffix, so every link
 * written to the obvious anchor silently resolves to the FIRST heading. The
 * link works, the reader lands somewhere else, and nothing reports it.
 */
export async function checkDuplicateAnchors(repoRoot) {
  const problems = [];
  for (const file of await docFiles(repoRoot)) {
    const seen = new Map();
    for (const heading of headings(await readDoc(repoRoot, file))) {
      const first = seen.get(heading.anchor);
      if (first !== undefined) {
        problems.push({
          where: `${file}:${heading.line}`,
          message: `"${heading.text}" repeats the anchor #${heading.anchor} from line ${first} — links to it reach only the first`,
        });
      } else {
        seen.set(heading.anchor, heading.line);
      }
    }
  }
  return problems;
}

export { slugify };
