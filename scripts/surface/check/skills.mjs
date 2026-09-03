// Assert community Agent Skills name only commands and tools the code ships.
//
// Skills are a third consumer of `docs/surface.json`, alongside website docs and
// scenarios. They are hand-written workflows (not generated from the manifest),
// so this check owns only the mechanical facts: a skill that cites
// `get_native_tree` or `real-a11y compare-producers` is the same class of bug
// `check/docs.mjs` was built for.
//
// It deliberately does NOT require every shipped command to appear in a skill —
// skills are workflows, not an exhaustive index. Prose meaning stays human
// (dogfood / D8). See docs/maintainers/community-skills.md.

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const SKILLS_DIR = "community-skills";

/** MCP tool names in code spans — same shape as check/docs.mjs. */
const MCP_TOOL_SPAN = /`([a-z]+_[a-z_]+)`/g;

/**
 * CLI invocations a skill might write. Matches `real-a11y audit`,
 * `npx real-a11y audit`, and code spans that open with the bin.
 */
function cliInvocations(text, bin) {
  const names = new Set();
  const re = new RegExp(`(?:\`|\\b(?:npx\\s+)?)${bin}\\s+([a-z][\\w-]*)`, "g");
  for (const m of text.matchAll(re)) names.add(m[1]);
  return [...names];
}

async function listSkillFiles(repoRoot) {
  const root = resolve(repoRoot, SKILLS_DIR);
  try {
    const st = await stat(root);
    if (!st.isDirectory()) return { missing: false, files: [] };
  } catch {
    return { missing: true, files: [] };
  }

  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Staging mirrors a public skills repo — skip hidden / plugin dirs.
        if (entry.name.startsWith(".")) continue;
        await walk(full);
      } else if (entry.name === "SKILL.md") {
        files.push(relative(repoRoot, full));
      }
    }
  };
  await walk(root);
  files.sort();
  return { missing: false, files };
}

/**
 * @param {string} repoRoot
 * @param {object} manifest
 * @returns {Promise<{where: string, message: string}[]>}
 */
export async function checkSkills(repoRoot, manifest) {
  const problems = [];
  const fail = (where, message) => problems.push({ where, message });

  const { missing, files } = await listSkillFiles(repoRoot);
  if (missing) {
    // Tree not present yet (or deleted) — nothing to check. Plan still maps
    // obligations; when the staging tree lands, this branch starts enforcing.
    return problems;
  }

  if (files.length === 0) {
    fail(
      `${SKILLS_DIR}/`,
      `exists but contains no SKILL.md files — either add the workflow skills or remove the empty tree`,
    );
    return problems;
  }

  const { bin } = manifest.cli;
  const commands = new Set(manifest.cli.commands.map((c) => c.name));
  const tools = new Set(manifest.mcp.tools.map((t) => t.name));

  for (const file of files) {
    const text = await readFile(resolve(repoRoot, file), "utf8");

    const ghostTools = [
      ...new Set([...text.matchAll(MCP_TOOL_SPAN)].map((m) => m[1])),
    ].filter((n) => !tools.has(n));
    if (ghostTools.length) {
      fail(
        file,
        `names MCP tools the code doesn't ship: ${ghostTools.join(", ")}`,
      );
    }

    const ghostCmds = cliInvocations(text, bin).filter((n) => !commands.has(n));
    if (ghostCmds.length) {
      fail(
        file,
        `names CLI commands the code doesn't ship: ${ghostCmds.join(", ")}`,
      );
    }
  }

  return problems;
}
