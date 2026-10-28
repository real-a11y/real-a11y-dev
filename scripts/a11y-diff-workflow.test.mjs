// What the `Comment` job of `.github/workflows/a11y-diff.yml` does, asserted
// against the workflow's own script and `if:` rather than a copy of them.
//
//   pnpm test:scripts                                  all of them (and part of `pnpm verify`)
//   node --test scripts/a11y-diff-workflow.test.mjs    just this file
//
// WHY. Nothing in `pnpm verify` executes a workflow, and this job had two
// failures that only production could show. Its lookup for the sticky comment
// read one page of comments — 30, the REST default — so on a PR whose comment
// sat past that, it posted a fresh one on every push. And on a fork PR, whose
// `pull_request` token cannot write whatever the job asks for, posting failed
// with a 403 and turned the run red over nothing in the change.
//
// So the script is lifted out of the workflow and run the way `github-script`
// runs it — the body of an async function handed `github`, `context` and
// `require` — against an in-memory pull request that pages its comments the way
// the REST API does. The job's `if:` is evaluated against a same-repo payload
// and a fork one. `pr-risk-workflow.test.mjs` does the same for pr-risk, and
// says more about why the real step beats a transcription.
//
// Node's own test runner and node core only, like the rest of `scripts/`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const WORKFLOW = readFileSync(
  fileURLToPath(new URL("../.github/workflows/a11y-diff.yml", import.meta.url)),
  "utf8",
).split(/\r?\n/);

const indentOf = (line) => line.search(/\S/);

/**
 * The lines of `from` up to the next non-blank line indented no deeper than
 * `from` itself — a YAML node and everything nested under it, without a YAML
 * parser.
 */
function nodeAt(lines, from) {
  const end = lines.findIndex(
    (line, i) =>
      i > from && line.trim() && indentOf(line) <= indentOf(lines[from]),
  );
  return lines.slice(from, end === -1 ? undefined : end);
}

/** The lines of the job with id `id`, from its key to the next job. */
function jobLines(id) {
  const at = WORKFLOW.findIndex((line) => line === `  ${id}:`);
  assert.notEqual(
    at,
    -1,
    `a11y-diff.yml has no job \`${id}\`. If it was renamed, rename it here too.`,
  );
  return nodeAt(WORKFLOW, at);
}

/** The `if:` expression set on the job itself, not on one of its steps. */
function jobIf(id) {
  const line = jobLines(id).find((l) => l.startsWith("    if: "));
  assert.ok(line, `job \`${id}\` has no job-level \`if:\``);
  return line.slice("    if: ".length).trim();
}

/** The `script: |` block of the step named `name` in the job `id`. */
function stepScript(id, name) {
  const job = jobLines(id);
  const step = job.findIndex((line) => line.trim() === `- name: ${name}`);
  assert.notEqual(step, -1, `job \`${id}\` has no step named "${name}"`);
  const lines = nodeAt(job, step);
  const at = lines.findIndex((line) => line.trim() === "script: |");
  assert.notEqual(at, -1, `step "${name}" has no \`script: |\``);
  const body = nodeAt(lines, at).slice(1);
  const margin = Math.min(
    ...body.filter((line) => line.trim()).map((line) => indentOf(line)),
  );
  return body.map((line) => line.slice(margin)).join("\n");
}

/**
 * An `if:` the way Actions reads the one form this job uses: two property
 * paths compared with `==`. Anything else throws — teach it here rather than
 * let a case pass on something it never evaluated.
 */
function evaluateIf(expression, context) {
  const match = expression.match(/^([\w.]+) == ([\w.]+)$/);
  if (!match) throw new Error(`this test can't evaluate \`${expression}\``);
  const lookup = (path) =>
    path.split(".").reduce((value, key) => value?.[key], context);
  const [left, right] = [lookup(match[1]), lookup(match[2])];
  // Actions compares two strings ignoring case.
  return typeof left === "string" && typeof right === "string"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

const OWNER = "real-a11y";
const REPO = "real-a11y-dev";
const NUMBER = 7;
const MARKER = "<!-- real-a11y-diff -->";
const BOT = "github-actions[bot]";

/** A diff the audit job could have uploaded, with one new finding in it. */
const ARTIFACT = {
  "diff.md": "## ⚠️ A11y changed\n\n1 new finding.",
  "diff.json": JSON.stringify({
    summary: { new: 1, changed: 0, removed: 0 },
    pages: [],
  }),
};

/**
 * A pull request with `comments`, oldest first, behind a `github` that pages
 * them the way the REST API does: `per_page` to a page, 30 when not asked.
 * `paginate` asks for pages until one comes back short, which is where
 * Octokit's `Link` header runs out.
 */
function pullRequest(comments) {
  const state = {
    comments: comments.map((comment, i) => ({ id: 100 + i, ...comment })),
    created: [],
    updated: [],
  };
  const issues = {
    listComments: async ({ per_page = 30, page = 1 }) => ({
      data: state.comments.slice((page - 1) * per_page, page * per_page),
    }),
    createComment: async ({ issue_number, body }) => {
      state.created.push({ issue_number, body });
    },
    updateComment: async ({ comment_id, body }) => {
      state.updated.push({ comment_id, body });
    },
  };
  const github = {
    rest: {
      issues,
      actions: { listJobsForWorkflowRun: async () => ({ data: { jobs: [] } }) },
    },
    paginate: async (method, params) => {
      const all = [];
      for (let page = 1; ; page++) {
        const { data } = await method({ ...params, page });
        all.push(...data);
        if (data.length < (params.per_page ?? 30)) return all;
      }
    },
  };
  return { github, state };
}

/** Run the Comment job's script as `github-script` does; resolve to its log. */
async function postComment(github) {
  const log = [];
  const script = stepScript("comment", "Post PR comment");
  assert.doesNotMatch(
    script,
    /\$\{\{/,
    "the script holds an Actions expression this test does not substitute",
  );
  const step = new AsyncFunction(
    "require",
    "github",
    "context",
    "console",
    script,
  );
  const files = {
    readFileSync: (path) => {
      assert.ok(
        path in ARTIFACT,
        `the script read ${path}, not in the artifact`,
      );
      return ARTIFACT[path];
    },
  };
  await step(
    (id) => (id === "fs" ? files : require(id)),
    github,
    {
      repo: { owner: OWNER, repo: REPO },
      issue: { owner: OWNER, repo: REPO, number: NUMBER },
      serverUrl: "https://github.com",
      runId: 1,
    },
    { log: (...args) => log.push(args.join(" ")) },
  );
  return log;
}

const others = (count) =>
  Array.from({ length: count }, (_, i) => ({
    user: { login: `reviewer-${i}` },
    body: `comment ${i}`,
  }));

describe("a11y-diff Comment job: the sticky comment", () => {
  it("updates its comment when that comment is past the first page", async () => {
    // 30 comments before ours is a full first page, so ours is the first
    // comment on page two.
    const { github, state } = pullRequest([
      ...others(30),
      { user: { login: BOT }, body: `${MARKER}\nan earlier diff` },
      ...others(5),
    ]);

    const log = await postComment(github);

    assert.deepEqual(state.created, []);
    assert.equal(state.updated.length, 1);
    assert.equal(state.updated[0].comment_id, 130);
    assert.ok(state.updated[0].body.startsWith(`${MARKER}\n`));
    assert.deepEqual(log, ["Updated a11y-diff comment 130"]);
  });

  it("posts one comment when none of the pages has one", async () => {
    const { github, state } = pullRequest(others(130));

    const log = await postComment(github);

    assert.deepEqual(state.updated, []);
    assert.equal(state.created.length, 1);
    assert.equal(state.created[0].issue_number, NUMBER);
    assert.deepEqual(log, ["Posted new a11y-diff comment"]);
  });

  it("adopts only the bot's comment with the marker as its first line", async () => {
    const { github, state } = pullRequest([
      { user: { login: "someone" }, body: `${MARKER}\nquoted by a person` },
      { user: { login: BOT }, body: `another bot note\n${MARKER}` },
    ]);

    await postComment(github);

    assert.deepEqual(state.updated, []);
    assert.equal(state.created.length, 1);
  });
});

describe("a11y-diff Comment job: which pull requests it runs on", () => {
  const runsFor = (headRepo) =>
    evaluateIf(jobIf("comment"), {
      github: {
        repository: `${OWNER}/${REPO}`,
        event: { pull_request: { head: { repo: headRepo } } },
      },
    });

  it("runs on a pull request from a branch of this repository", () => {
    assert.equal(runsFor({ full_name: `${OWNER}/${REPO}` }), true);
  });

  it("skips a pull request from a fork, whose token cannot write", () => {
    assert.equal(runsFor({ full_name: `someone/${REPO}` }), false);
  });

  it("skips a pull request whose fork has been deleted", () => {
    // GitHub sends `head.repo: null` once the fork is gone.
    assert.equal(runsFor(null), false);
  });
});
