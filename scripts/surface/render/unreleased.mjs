// The "not yet published" notice on the CLI reference.
//
// A reader on real-a11y.dev has no way to tell whether the flag they are
// reading about is in the version `npm install` gives them. The site deploys on
// every push to `main`; npm publishes on a release cut. This says so, on the
// page, using the two manifests rather than anyone's memory.
//
// FULLY GENERATED, UNLIKE EVERY OTHER REGION
//
// The command and exit-code regions merge (see ./table.mjs): the generator owns
// which rows exist, a human owns their prose. This one owns its whole body,
// which is only defensible because it contains no prose to own — every line is
// a flag name and a version number, both read straight out of the manifests.
// Nothing here is a sentence someone would want to improve, so there is nothing
// for a merge to protect.
//
// IT SAYS NOTHING RATHER THAN SOMETHING FALSE
//
// The body is EMPTY in both of the cases where there is no true warning to give:
//
//   - Nothing is unreleased. A standing "everything here is published" banner is
//     noise that has to stay correct forever to earn its space.
//   - The released surface is unrecorded (no snapshot yet, or one written under
//     an older manifest layout). A permanent "we don't know" placeholder on a
//     published page is worse than silence: it is an admission with no action
//     attached, sitting in front of every reader until the next release.
//
// The unrecorded case is still reported — by `surface:snapshot` and by the
// tooling, to the people who can fix it — just not to the reader, who cannot.
// See ../released.mjs for why "unrecorded" is kept distinct from "nothing is
// unreleased" in the first place.

import { loadReleased, unreleasedKeys } from "../released.mjs";

export const CLI_PACKAGE = "@real-a11y-dev/cli";

/** Only the CLI half of the surface — this region lives on the CLI reference. */
function cliOnly(keys) {
  return keys.filter((key) => key.startsWith("cli."));
}

/**
 * A key like `cli.audit.--allow-file` → the pair a reader recognises.
 * Command-level keys (`cli.tree`) have no flag.
 */
function describe(key) {
  const [, command, flag] = key.split(".");
  return { command, flag };
}

/**
 * Render the notice.
 *
 * Exported separately from the builder so the shape can be exercised against
 * synthetic manifests without a repo on disk.
 *
 * @param {string[]|null} unreleased  null when the released surface is unrecorded
 * @param {Map<string, string>} versions  package name → released version
 * @returns {string} region body; "" when there is nothing true to say
 */
export function renderNotice(unreleased, versions) {
  if (unreleased === null) return "";
  const cli = cliOnly(unreleased);
  if (cli.length === 0) return "";

  const version = versions.get(CLI_PACKAGE);
  // Name the version when it is known. Without it the sentence still works —
  // "the newest release" — and inventing a number would be worse than omitting
  // one, since this notice exists to stop the page overstating what shipped.
  const release = version
    ? `\`${CLI_PACKAGE}\` ${version}`
    : "the newest release";

  const commands = cli.filter((key) => !describe(key).flag);

  // A brand-new command brings every one of its flags with it, and listing them
  // under it is pure noise — `login` arriving unreleased would otherwise print
  // eight more lines saying `login --help`, `login --config`, `login --quiet`
  // are unreleased too. They are, trivially, and saying so buries the one line
  // that matters. Only flags on an ALREADY-RELEASED command are news.
  const newCommands = new Set(commands.map((key) => describe(key).command));
  const flags = cli.filter((key) => {
    const { command, flag } = describe(key);
    return flag && !newCommands.has(command);
  });

  const lines = [
    "",
    "::: info Not in the published release yet",
    `Some of what this page documents is on \`main\` but not in ${release}, so`,
    "installing from npm today will not have it:",
    "",
  ];

  for (const key of commands) {
    lines.push(`- \`${describe(key).command}\` — the whole command`);
  }
  for (const key of flags) {
    const { command, flag } = describe(key);
    lines.push(`- \`${command} ${flag}\``);
  }

  lines.push("", ":::", "");
  return lines.join("\n");
}

/**
 * The builder, plus the state it was computed from.
 *
 * `released` comes back out so `apply` can tell the author the notice could not
 * be computed. The reader is not told — see the header — but whoever ran the
 * command has to be, or "the site is silent about release status" becomes
 * indistinguishable from "the site checked, and there is nothing to say".
 *
 * `added`/`removed`/`removedRows` are empty because this region has no rows to
 * merge — they drive the TODO-prose reporting in ./index.mjs, which does not
 * apply to a body with no prose in it.
 *
 * CANNOT-COMPUTE IS NOT THE SAME AS COMPUTES-TO-EMPTY
 *
 * When the snapshot is damaged or at an older layout, there is no answer — and
 * rendering "" would be asserting one. Worse, it would be a DESTRUCTIVE
 * assertion: `checkDrift` would then report `cli-unreleased` as out of date and
 * tell the author to run `pnpm surface:apply`, and following that advice wipes
 * a notice that was accurate when it was written. The drift message would also
 * blame `docs/surface.json`, which had nothing to do with it.
 *
 * So those two cases leave the region exactly as they found it. No drift, no
 * destructive remedy, and `checkReleasedSnapshot` still reports the real fault.
 *
 * `absent` DOES render empty, because that one is not a failure to compute: it
 * is the pre-first-release state, where nothing is recorded and an empty notice
 * is the honest page.
 *
 * @param {string} repoRoot
 * @param {object} manifest
 */
export async function unreleasedRegion(repoRoot, manifest) {
  const released = await loadReleased(repoRoot);
  const computable = released.recorded || released.reason === "absent";
  const body = renderNotice(
    unreleasedKeys(manifest, released),
    released.versions,
  );

  return {
    released,
    builder: (current) => ({
      body: computable ? body : current,
      added: [],
      removed: [],
      removedRows: new Map(),
      problems: [],
    }),
  };
}
