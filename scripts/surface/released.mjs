// What is published, and what is only on `main`.
//
// Reads `docs/surface.released.json` (written by `snapshot` during the release
// cut) and answers, for one surface item, whether the newest release exposes it.
//
// THREE ANSWERS, NOT TWO — and this is the whole design.
//
// "The released surface isn't recorded" is a different fact from "nothing is
// unreleased", and collapsing them produces a confident, wrong, and very
// plausible-looking page. Both mistakes are worse than saying nothing:
//
//   - Treating an absent snapshot as "everything is released" prints a page
//     asserting that `main` is published. That is the exact claim the snapshot
//     exists to stop anyone from making.
//   - Treating it as "nothing is released" flags all 14 commands and 19 tools
//     as unshipped, which is both false and so obviously false that a reader
//     learns to ignore the marker — which costs more than never shipping it.
//
// So an unrecorded released surface reports itself as unrecorded, says why, and
// asserts nothing about any individual capability. Same shape as `plan`'s
// `unavailable(reason)` in plan/versions.mjs, for the same reason.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { MANIFEST_VERSION } from "./model.mjs";

export const RELEASED_REL = "docs/surface.released.json";

/**
 * @typedef {object} Released
 * @property {boolean} recorded
 * @property {"absent"|"unreadable"|"layout"} [reason]  why not, when not
 * @property {string} [detail]                          extra context for `layout`
 * @property {Set<string>} keys  every released surface key; empty when unrecorded
 * @property {Map<string, string>} versions  package name → released version
 */

/**
 * Load the released surface.
 *
 * @param {string} repoRoot
 * @returns {Promise<Released>}
 */
export async function loadReleased(repoRoot) {
  let raw;
  try {
    raw = await readFile(join(repoRoot, RELEASED_REL), "utf8");
  } catch {
    return unrecorded("absent");
  }

  let snapshot;
  try {
    snapshot = JSON.parse(raw);
  } catch {
    return unrecorded("unreadable");
  }

  // A snapshot written under an older manifest layout cannot be compared key by
  // key: the extractors that produced it may have named or nested things
  // differently, so every key could differ for reasons that have nothing to do
  // with what shipped. Refusing to compare is the only answer that isn't a
  // guess — and it self-heals, because the next release cut rewrites the file
  // at the current layout.
  if (snapshot.manifestVersion !== MANIFEST_VERSION) {
    return unrecorded(
      "layout",
      `snapshot is at manifest v${snapshot.manifestVersion ?? "?"}, code is at v${MANIFEST_VERSION}`,
    );
  }

  return {
    recorded: true,
    keys: new Set(surfaceKeys(snapshot)),
    versions: new Map(
      (snapshot.packages ?? [])
        .filter((p) => !p.private && p.version)
        .map((p) => [p.name, p.version]),
    ),
  };
}

function unrecorded(reason, detail) {
  return {
    recorded: false,
    reason,
    detail,
    keys: new Set(),
    versions: new Map(),
  };
}

/**
 * Every capability in a manifest, as stable dotted keys.
 *
 * The same vocabulary `plan` uses for change paths (`cli.<cmd>`, `mcp.<tool>`,
 * `packages.<name>`), so a key that appears in a `surface:plan` report and a key
 * that appears here mean the same thing. Flags and tool parameters are included
 * because they are the granularity people actually get wrong — a command that
 * shipped two releases ago growing a flag last week is the common case, and a
 * command-level answer would call the whole thing released.
 *
 * @param {object} manifest
 * @returns {string[]}
 */
export function surfaceKeys(manifest) {
  const keys = [];

  for (const command of manifest.cli?.commands ?? []) {
    keys.push(`cli.${command.name}`);
    for (const flag of command.flags ?? [])
      keys.push(`cli.${command.name}.--${flag.name}`);
  }

  for (const tool of manifest.mcp?.tools ?? []) {
    keys.push(`mcp.${tool.name}`);
    // Parameters, for the same reason as flags: a tool that shipped two
    // releases ago growing a parameter last week is the common case, and a
    // tool-level answer would call the whole thing released. Without these the
    // MCP notice would be quietly incomplete the moment it is added.
    for (const param of Object.keys(tool.inputSchema?.properties ?? {}))
      keys.push(`mcp.${tool.name}.${param}`);
  }

  for (const pkg of manifest.packages ?? []) {
    if (pkg.private) continue;
    keys.push(`packages.${pkg.dir}`);
    for (const subpath of pkg.exports ?? [])
      keys.push(`packages.${pkg.dir}.${subpath}`);
  }

  for (const variable of manifest.env ?? []) {
    keys.push(`env.${variable.name ?? variable}`);
  }

  return keys;
}

/**
 * Fail when the snapshot is present but unreadable.
 *
 * Deliberately narrow, because two of the three unrecorded states must NOT fail:
 *
 *   - `absent` is the legitimate pre-first-release state. Failing on it would
 *     make every PR red until someone cuts a release, to report a condition
 *     nobody can fix from a PR.
 *   - `layout` self-heals — the next release cut rewrites the file at the
 *     current manifest version. Failing on it would block every PR in the
 *     window after a `MANIFEST_VERSION` bump, again for something a PR author
 *     cannot resolve.
 *
 * `unreadable` is different in kind: a corrupt file is not a state the release
 * process produces, it is damage. And it is silent — the notice just renders
 * empty, which reads exactly like "nothing is unreleased". Without this, the
 * page would quietly stop warning anyone and no check would ever say so.
 *
 * @param {string} repoRoot
 * @returns {Promise<{where: string, message: string}[]>}
 */
export async function checkReleasedSnapshot(repoRoot) {
  const released = await loadReleased(repoRoot);
  if (released.recorded || released.reason !== "unreadable") return [];
  return [
    {
      where: RELEASED_REL,
      message:
        `exists but isn't valid JSON, so the released surface can't be read.\n    ` +
        `The "not published yet" notice renders empty when that happens, which ` +
        `is indistinguishable on the page from "everything here is published" — ` +
        `so this fails loudly rather than letting the docs quietly stop warning ` +
        `anyone.\n\n      git checkout ${RELEASED_REL}   # if it was corrupted locally`,
    },
  ];
}

/**
 * The capabilities on `main` that the newest release does not expose.
 *
 * Returns `null` — not an empty array — when the released surface is unrecorded.
 * An empty array means "checked, nothing is unreleased"; null means "could not
 * check". Callers have to render those differently, so they cannot share a type.
 *
 * @param {object} manifest   the current surface
 * @param {Released} released
 * @returns {string[]|null}
 */
export function unreleasedKeys(manifest, released) {
  if (!released.recorded) return null;
  return surfaceKeys(manifest).filter((key) => !released.keys.has(key));
}
