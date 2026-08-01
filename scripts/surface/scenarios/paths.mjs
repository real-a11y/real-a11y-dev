// The vocabulary of manifest paths — one enumeration, two consumers.
//
// `plan/diff.mjs` emits paths like `cli.commands.audit.flags.--fail-on` when
// something moves. A scenario's `covers:` list names paths in that same
// vocabulary. That is the whole trick: because both sides speak one language, a
// change path can be matched against `covers` directly, with no mapping table in
// between — which is what lets `plan` finally name the affected scenario rows
// instead of saying "check them by hand".
//
// It only works if the two agree about what a valid path is, so the valid set is
// enumerated here rather than described twice. A `covers:` entry that isn't in
// this set is a ghost, and a capability in this set that nothing covers is a
// coverage gap. Both fall out of the same function.

/**
 * Every path the manifest can be addressed by, as a Set.
 *
 * Deliberately includes the leaf paths (a flag, a parameter) as well as the
 * capability paths (a command, a tool), because a scenario legitimately covers
 * either: R5 covers `snapshot`'s `--md` specifically, R3 covers `audit` whole.
 */
export function manifestPaths(manifest) {
  const paths = new Set();

  for (const command of manifest.cli?.commands ?? []) {
    paths.add(`cli.commands.${command.name}`);
    for (const flag of command.flags ?? []) {
      paths.add(`cli.commands.${command.name}.flags.--${flag.name}`);
    }
  }
  if (manifest.cli?.exitCodes) paths.add("cli.exitCodes");

  for (const tool of manifest.mcp?.tools ?? []) {
    paths.add(`mcp.tools.${tool.name}`);
    for (const param of Object.keys(tool.inputSchema?.properties ?? {})) {
      paths.add(`mcp.tools.${tool.name}.params.${param}`);
    }
  }

  for (const pkg of manifest.packages ?? []) {
    paths.add(`packages.${pkg.name}`);
  }
  for (const variable of manifest.env ?? []) {
    paths.add(`env.${variable.name}`);
  }

  return paths;
}

/**
 * The paths a release has to have *some* scenario for.
 *
 * Commands and tools only — the things a user invokes. Requiring a scenario per
 * flag and per parameter would be a coverage number nobody could ever satisfy,
 * and a target that can't be met is one people learn to ignore. Private
 * packages are excluded for the same reason: nothing installs them.
 */
export function coverageTargets(manifest) {
  const targets = [];
  for (const command of manifest.cli?.commands ?? []) {
    targets.push({
      path: `cli.commands.${command.name}`,
      label: `CLI \`${command.name}\``,
    });
  }
  for (const tool of manifest.mcp?.tools ?? []) {
    targets.push({
      path: `mcp.tools.${tool.name}`,
      label: `MCP \`${tool.name}\``,
    });
  }
  return targets;
}

/**
 * Does `covered` account for `path`?
 *
 * A scenario covering a whole command also covers its flags — someone exercising
 * `audit` end to end is exercising `--fail-on` — so a prefix match counts. The
 * boundary check stops `cli.commands.audit` from appearing to cover
 * `cli.commands.audit-extra`, which a bare `startsWith` would.
 *
 * ANCESTOR ONLY, and not symmetric. A row listing just
 * `cli.commands.snapshot.flags.--md` has not covered `snapshot`: exercising one
 * flag is not exercising the command, and letting it satisfy the gate would be
 * the false confidence the gate exists to prevent.
 *
 * `plan`'s `coveringScenarios` deliberately uses the OTHER rule — either side a
 * prefix of the other — because it answers a different question: not "is this
 * covered?" but "is this row affected by that change?". A row testing one flag of
 * a command that just got deleted is affected. Keeping the two predicates apart is
 * intentional; collapsing them would either weaken this gate or make the plan miss
 * rows.
 */
export function covers(covered, path) {
  return covered.some(
    (entry) => entry === path || path.startsWith(`${entry}.`),
  );
}
