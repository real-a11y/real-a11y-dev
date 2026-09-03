// Community-skills ghost-name check — black-box enough to run without a build.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, after } from "node:test";

import { checkSkills } from "./surface/check/skills.mjs";

const MANIFEST = {
  cli: {
    bin: "real-a11y",
    commands: [{ name: "audit" }, { name: "install" }, { name: "tree" }],
  },
  mcp: {
    tools: [{ name: "open_page" }, { name: "audit_page" }],
  },
};

describe("checkSkills", () => {
  /** @type {string[]} */
  const temps = [];
  after(async () => {
    await Promise.all(
      temps.map((d) => rm(d, { recursive: true, force: true })),
    );
  });

  async function withSkills(files) {
    const root = await mkdtemp(join(tmpdir(), "skills-check-"));
    temps.push(root);
    for (const [rel, body] of Object.entries(files)) {
      const full = join(root, rel);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, body);
    }
    return root;
  }

  it("skips when community-skills/ is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-absent-"));
    temps.push(root);
    assert.deepEqual(await checkSkills(root, MANIFEST), []);
  });

  it("fails closed on an empty community-skills/ tree", async () => {
    const root = await withSkills({});
    await mkdir(join(root, "community-skills"));
    const problems = await checkSkills(root, MANIFEST);
    assert.equal(problems.length, 1);
    assert.match(problems[0].message, /no SKILL\.md/);
  });

  it("passes when skills only cite shipped names", async () => {
    const root = await withSkills({
      "community-skills/audit-a-page/SKILL.md": `
# Audit
\`open_page\` then \`audit_page\`
\`\`\`
npx real-a11y install
npx real-a11y audit https://example.com
\`\`\`
`,
    });
    assert.deepEqual(await checkSkills(root, MANIFEST), []);
  });

  it("fails on ghost MCP tools and ghost CLI commands", async () => {
    const root = await withSkills({
      "community-skills/broken/SKILL.md": `
Use \`get_native_tree\` then \`real-a11y compare-producers\`
`,
    });
    const problems = await checkSkills(root, MANIFEST);
    assert.equal(problems.length, 2);
    assert.match(problems.map((p) => p.message).join("\n"), /get_native_tree/);
    assert.match(
      problems.map((p) => p.message).join("\n"),
      /compare-producers/,
    );
  });
});
