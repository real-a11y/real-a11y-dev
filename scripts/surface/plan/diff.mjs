// What moved in the public surface between two manifests.
//
// This is why `docs/surface.json` is committed rather than generated on demand:
// the diff of two commits of one file IS the change list, exactly, with no
// heuristics about which source files a PR touched or what they implied. A
// renamed flag is one removal and one addition, not "packages/cli/src changed".
//
// It reads manifests, so it needs no build and no extraction — which is what
// makes the CI job that consumes it cheap enough to run on every PR.

/** @typedef {{ kind: "added"|"removed"|"changed", path: string, what: string, detail?: string }} Change */

const added = (path, what, detail) => ({ kind: "added", path, what, detail });
const removed = (path, what, detail) => ({
  kind: "removed",
  path,
  what,
  detail,
});
const changed = (path, what, detail) => ({
  kind: "changed",
  path,
  what,
  detail,
});

/** Index a list of `{name}` records for set comparison. */
function byName(list) {
  return new Map((list ?? []).map((item) => [item.name, item]));
}

function diffCommands(base, head) {
  const changes = [];
  const before = byName(base?.cli?.commands);
  const after = byName(head?.cli?.commands);

  for (const [name, command] of after) {
    if (!before.has(name)) {
      changes.push(
        added(`cli.commands.${name}`, `the \`${name}\` command`, command.usage),
      );
      continue;
    }
    const was = before.get(name);

    // A command's own facts. `summary` is help text a user reads, and `usage`
    // is the invocation shape — both are documented verbatim, so both are
    // worth reporting even though neither adds or removes a capability.
    if (was.summary !== command.summary) {
      changes.push(
        changed(
          `cli.commands.${name}.summary`,
          `\`${name}\`'s summary`,
          `"${was.summary}" → "${command.summary}"`,
        ),
      );
    }
    if (was.usage !== command.usage) {
      changes.push(
        changed(
          `cli.commands.${name}.usage`,
          `\`${name}\`'s invocation`,
          `${was.usage} → ${command.usage}`,
        ),
      );
    }
    if (was.producers.join() !== command.producers.join()) {
      changes.push(
        changed(
          `cli.commands.${name}.producers`,
          `which producers \`${name}\` accepts`,
          `${was.producers.join(" · ") || "—"} → ${command.producers.join(" · ") || "—"}`,
        ),
      );
    }
    if (was.group !== command.group) {
      changes.push(
        changed(
          `cli.commands.${name}.group`,
          `\`${name}\`'s section in the reference`,
          `${was.group} → ${command.group}`,
        ),
      );
    }

    const wasFlags = byName(was.flags);
    const nowFlags = byName(command.flags);
    for (const [flag, spec] of nowFlags) {
      if (!wasFlags.has(flag)) {
        changes.push(
          added(
            `cli.commands.${name}.flags.--${flag}`,
            `\`--${flag}\` on \`${name}\``,
            spec.type,
          ),
        );
      } else if (
        JSON.stringify(wasFlags.get(flag)) !== JSON.stringify(spec) // type/short/multiple
      ) {
        changes.push(
          changed(
            `cli.commands.${name}.flags.--${flag}`,
            `\`--${flag}\` on \`${name}\``,
            `${JSON.stringify(wasFlags.get(flag))} → ${JSON.stringify(spec)}`,
          ),
        );
      }
    }
    for (const flag of wasFlags.keys()) {
      if (!nowFlags.has(flag)) {
        changes.push(
          removed(
            `cli.commands.${name}.flags.--${flag}`,
            `\`--${flag}\` on \`${name}\``,
          ),
        );
      }
    }
  }

  for (const [name] of before) {
    if (!after.has(name)) {
      changes.push(removed(`cli.commands.${name}`, `the \`${name}\` command`));
    }
  }

  // Exit codes are a frozen contract; any movement at all is a headline.
  const wasExit = JSON.stringify(base?.cli?.exitCodes ?? []);
  const nowExit = JSON.stringify(head?.cli?.exitCodes ?? []);
  if (wasExit !== nowExit) {
    changes.push(
      changed(
        "cli.exitCodes",
        "the exit-code contract",
        "frozen within 0.x — confirm this is intended",
      ),
    );
  }

  return changes;
}

function diffTools(base, head) {
  const changes = [];
  const before = byName(base?.mcp?.tools);
  const after = byName(head?.mcp?.tools);

  for (const [name, tool] of after) {
    if (!before.has(name)) {
      changes.push(
        added(`mcp.tools.${name}`, `the \`${name}\` tool`, tool.title),
      );
      continue;
    }
    const was = before.get(name);

    if (was.description !== tool.description) {
      changes.push(
        changed(
          `mcp.tools.${name}.description`,
          `\`${name}\`'s description`,
          "the text an agent reads to decide whether to call it",
        ),
      );
    }

    const wasProps = was.inputSchema?.properties ?? {};
    const nowProps = tool.inputSchema?.properties ?? {};
    for (const param of Object.keys(nowProps)) {
      if (!(param in wasProps)) {
        changes.push(
          added(
            `mcp.tools.${name}.params.${param}`,
            `\`${param}\` on \`${name}\``,
          ),
        );
      } else if (
        JSON.stringify(wasProps[param]) !== JSON.stringify(nowProps[param])
      ) {
        changes.push(
          changed(
            `mcp.tools.${name}.params.${param}`,
            `\`${param}\` on \`${name}\``,
            describeParamChange(wasProps[param], nowProps[param]),
          ),
        );
      }
    }
    for (const param of Object.keys(wasProps)) {
      if (!(param in nowProps)) {
        changes.push(
          removed(
            `mcp.tools.${name}.params.${param}`,
            `\`${param}\` on \`${name}\``,
          ),
        );
      }
    }

    const wasReq = (was.inputSchema?.required ?? []).join();
    const nowReq = (tool.inputSchema?.required ?? []).join();
    if (wasReq !== nowReq) {
      changes.push(
        changed(
          `mcp.tools.${name}.required`,
          `which parameters \`${name}\` requires`,
          `${wasReq || "none"} → ${nowReq || "none"}`,
        ),
      );
    }
  }

  for (const [name] of before) {
    if (!after.has(name)) {
      changes.push(removed(`mcp.tools.${name}`, `the \`${name}\` tool`));
    }
  }

  return changes;
}

/** The part of a parameter change a human cares about, not the whole schema. */
function describeParamChange(was, now) {
  if (was.type !== now.type) return `type ${was.type} → ${now.type}`;
  const wasEnum = (was.enum ?? []).join(", ");
  const nowEnum = (now.enum ?? []).join(", ");
  if (wasEnum !== nowEnum)
    return `values ${wasEnum || "—"} → ${nowEnum || "—"}`;
  if (was.default !== now.default)
    return `default ${JSON.stringify(was.default)} → ${JSON.stringify(now.default)}`;
  return "its schema";
}

function diffPackages(base, head) {
  const changes = [];
  const before = byName(base?.packages);
  const after = byName(head?.packages);

  for (const [name, pkg] of after) {
    if (!before.has(name)) {
      // The heaviest obligation in the repo — a new published package touches
      // seven documents, and the home page is the one people forget.
      changes.push(
        added(
          `packages.${name}`,
          `the \`${name}\` package`,
          pkg.private ? "private" : "published",
        ),
      );
      continue;
    }
    const was = before.get(name);

    // Publishing a package that already existed privately is the same event as
    // adding a published one — the seven-document obligation, the home page,
    // all of it — and it moves no other field, so nothing else here would
    // notice. The reverse (unpublishing) matters just as much: docs that tell
    // people to `npm install` it are now wrong.
    if (was.private !== pkg.private) {
      changes.push(
        changed(
          `packages.${name}.private`,
          `\`${name}\` is now ${pkg.private ? "private" : "published"}`,
          pkg.private ? "published → private" : "private → published",
        ),
      );
    }

    const wasExports = (was.exports ?? []).join();
    const nowExports = (pkg.exports ?? []).join();
    if (wasExports !== nowExports) {
      changes.push(
        changed(
          `packages.${name}.exports`,
          `\`${name}\`'s entry points`,
          `${wasExports || "—"} → ${nowExports || "—"}`,
        ),
      );
    }
    const wasBin = (was.bin ?? []).join();
    const nowBin = (pkg.bin ?? []).join();
    if (wasBin !== nowBin) {
      changes.push(
        changed(
          `packages.${name}.bin`,
          `\`${name}\`'s binaries`,
          `${wasBin || "—"} → ${nowBin || "—"}`,
        ),
      );
    }
  }

  for (const [name] of before) {
    if (!after.has(name)) {
      changes.push(removed(`packages.${name}`, `the \`${name}\` package`));
    }
  }
  return changes;
}

function diffEnv(base, head) {
  const changes = [];
  const before = byName(base?.env);
  const after = byName(head?.env);
  for (const [name] of after) {
    if (!before.has(name)) {
      changes.push(
        added(`env.${name}`, `the \`${name}\` environment variable`),
      );
    }
  }
  for (const [name] of before) {
    if (!after.has(name)) {
      changes.push(
        removed(`env.${name}`, `the \`${name}\` environment variable`),
      );
    }
  }
  return changes;
}

/**
 * @returns {Change[]} everything that moved, in a stable order — additions
 * first, because they are what needs writing; removals last, because they are
 * what needs deprecating.
 */
export function diffManifests(base, head) {
  const changes = [
    ...diffCommands(base, head),
    ...diffTools(base, head),
    ...diffPackages(base, head),
    ...diffEnv(base, head),
  ];
  const rank = { added: 0, changed: 1, removed: 2 };
  return changes.sort(
    (a, b) => rank[a.kind] - rank[b.kind] || a.path.localeCompare(b.path),
  );
}
