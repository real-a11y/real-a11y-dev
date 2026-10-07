// What `.github/workflows/pr-risk.yml` does with labels, asserted against the
// workflow's own steps rather than a copy of them.
//
//   pnpm test:scripts                                all of them (and part of `pnpm verify`)
//   node --test scripts/pr-risk-workflow.test.mjs    just this file
//
// WHY THESE ARE TESTED AT ALL. Every step below starts from the event payload,
// and the payload is a snapshot taken when the event fired — a run keeps it
// however late it starts, and a re-run reuses it outright. Force-pushing a
// stack fires `synchronize` on each layer twice, a second apart (head, then
// base), and both payloads list the labels from before either run touched
// them, so whichever run goes second starts from labels already changed under
// it. On 2026-10-05 that failed the required check on three layers at once
// with `HttpError: Label does not exist`, and re-running them failed
// identically. Nothing in `pnpm verify` executes a workflow, so until this file
// the only test these steps ever got was production.
//
// THE REAL STEPS, NOT A TRANSCRIPTION. Each case lifts its step's script out of
// the workflow file and runs it: a `github-script` body the way that action
// does — the body of an async function handed `github`, `context` and
// `require` — against an in-memory pull request, and the Gate's `run:` under
// bash against a stub rubric that reports the flags it was given. Logic copied
// into this file would keep passing while the workflow drifted; lifting it
// means editing the step is editing what is tested.
//
// Node's own test runner and node core only, like the rest of `scripts/` —
// see `pr-risk.test.mjs` for why.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const require = createRequire(import.meta.url);

const WORKFLOW = readFileSync(
  fileURLToPath(new URL("../.github/workflows/pr-risk.yml", import.meta.url)),
  "utf8",
);

/**
 * The block scalar under `key` (`script` or `run`) in the step named `name`.
 *
 * A YAML parser would be a dependency, and this file has none. The workflow is
 * regular enough for indentation to answer it: a step runs from its `- name:`
 * line to the next line indented no deeper than that dash, and the block is
 * every line after `key: |` that is blank or indented deeper than the key.
 * A step that has been renamed or reshaped fails here, loudly, rather than
 * leaving the cases below testing nothing.
 */
function stepBlock(name, key) {
  const lines = WORKFLOW.split(/\r?\n/);
  const indentOf = (line) => line.search(/\S/);

  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  assert.notEqual(
    start,
    -1,
    `pr-risk.yml has no step named "${name}". If it was renamed, rename it here too.`,
  );
  const stepIndent = indentOf(lines[start]);

  let at = -1;
  for (let i = start + 1; i < lines.length; i++) {
    const indent = indentOf(lines[i]);
    if (indent !== -1 && indent <= stepIndent) break;
    if (lines[i].trim() === `${key}: |`) {
      at = i;
      break;
    }
  }
  assert.notEqual(at, -1, `step "${name}" has no \`${key}: |\` block`);

  const body = [];
  for (let i = at + 1; i < lines.length; i++) {
    const indent = indentOf(lines[i]);
    if (indent !== -1 && indent <= indentOf(lines[at])) break;
    body.push(lines[i]);
  }
  const margin = Math.min(
    ...body.filter((line) => line.trim()).map((line) => indentOf(line)),
  );
  return body.map((line) => line.slice(margin)).join("\n");
}

/** Octokit's RequestError, as far as the steps look at it: a `status`. */
const httpError = (status, message) =>
  Object.assign(new Error(message), { status });

/**
 * A pull request's labels and comments behind the slice of Octokit the steps
 * call, answering the way GitHub does: 404 for removing a label the PR does not
 * have, 422 for creating one the repo already has.
 *
 * `onRemove(name, state)` runs before each removal, so a case can stand in for
 * another run getting there first (delete the label) or for GitHub failing
 * outright (throw).
 */
function pullRequest(labels, { onRemove } = {}) {
  const state = { labels: new Set(labels), removals: [], comments: [] };
  const asLabels = () => [...state.labels].map((name) => ({ name }));
  const issues = {
    createLabel: async () => {
      throw httpError(422, "Validation Failed");
    },
    listLabelsOnIssue: async () => ({ data: asLabels() }),
    removeLabel: async ({ name }) => {
      state.removals.push(name);
      onRemove?.(name, state);
      if (!state.labels.delete(name)) {
        throw httpError(404, "Label does not exist");
      }
      return { data: asLabels() };
    },
    addLabels: async ({ labels: added }) => {
      for (const name of added) state.labels.add(name);
      return { data: asLabels() };
    },
    listComments: async () => ({ data: state.comments }),
    createComment: async ({ body }) => {
      state.comments.push({
        id: state.comments.length + 1,
        user: { login: "github-actions[bot]" },
        body,
      });
      return { data: {} };
    },
    updateComment: async ({ comment_id, body }) => {
      state.comments.find((c) => c.id === comment_id).body = body;
      return { data: {} };
    },
  };
  const github = {
    rest: { issues },
    paginate: async (method, params) => (await method(params)).data,
  };
  return { state, github };
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

/**
 * Run a `github-script` body as the action does. `payload` is the label list
 * the event carried — deliberately separate from the PR's own labels, because
 * the two disagreeing is what every case here is about.
 *
 * `process` and `console` are passed too, shadowing the real ones, so a case
 * can point RUNNER_TEMP somewhere without touching this process's environment
 * and without the step's logging landing in the test report.
 */
function runScript(body, { github, payload, env = {} }) {
  assert.doesNotMatch(
    body,
    /\$\{\{/,
    "an expression the test has not substituted is still in the script",
  );
  const context = {
    repo: { owner: "real-a11y", repo: "real-a11y-dev" },
    issue: { number: 1 },
    payload: { pull_request: { labels: payload.map((name) => ({ name })) } },
  };
  const step = new AsyncFunction(
    "require",
    "github",
    "context",
    "process",
    "console",
    body,
  );
  return step(require, github, context, { env }, { log() {} });
}

const sorted = (labels) => [...labels].sort();

describe("dropping stale review labels on a new head", () => {
  const body = stepBlock("Drop stale review labels on a new head", "script");

  it("treats a label an earlier run for this head already removed as removed", async () => {
    // The 2026-10-05 failure, exactly: both `synchronize` payloads list
    // `reviewed:deep`, the first run took it off, and the second asked GitHub
    // to take it off again.
    const pr = pullRequest(["risk:medium"]);
    await runScript(body, {
      github: pr.github,
      payload: ["risk:high", "reviewed:deep"],
    });
    assert.deepEqual(pr.state.removals, ["reviewed:deep"]);
    assert.deepEqual(sorted(pr.state.labels), ["risk:medium"]);
  });

  it("removes both gate labels when they are there", async () => {
    const pr = pullRequest(["risk:high", "reviewed:deep", "risk-override"]);
    await runScript(body, {
      github: pr.github,
      payload: ["risk:high", "reviewed:deep", "risk-override"],
    });
    assert.deepEqual(sorted(pr.state.labels), ["risk:high"]);
  });

  it("keeps a review applied after the push", async () => {
    // The payload is the right source HERE, and the cases above are no reason
    // to switch it to the live list: it holds what was on the PR when the head
    // moved, so a review applied since — to this head — is not in it, and a
    // run that started late must not sweep it up.
    const pr = pullRequest(["risk:high", "reviewed:deep"]);
    await runScript(body, { github: pr.github, payload: ["risk:high"] });
    assert.deepEqual(pr.state.removals, []);
    assert.deepEqual(sorted(pr.state.labels), ["reviewed:deep", "risk:high"]);
  });

  it("still fails on anything but a 404", async () => {
    // Only "it is already gone" is the outcome this step wanted. A token that
    // cannot write labels, or GitHub having a bad minute, must stay red rather
    // than leave a review label standing on a head nobody reviewed.
    const pr = pullRequest(["reviewed:deep"], {
      onRemove: () => {
        throw httpError(403, "Resource not accessible by integration");
      },
    });
    await assert.rejects(
      runScript(body, { github: pr.github, payload: ["reviewed:deep"] }),
      { status: 403 },
    );
  });
});

describe("reconciling the risk label", () => {
  const body = stepBlock("Label and report", "script");
  const forTier = (tier) =>
    body.replaceAll("${{ steps.classify.outputs.tier }}", tier);

  let runnerTemp;
  before(async () => {
    runnerTemp = await mkdtemp(join(tmpdir(), "pr-risk-workflow-"));
    await writeFile(join(runnerTemp, "risk.md"), "report\n");
  });
  after(async () => {
    await rm(runnerTemp, { recursive: true, force: true, maxRetries: 3 });
  });

  const label = (pr, tier, payload) =>
    runScript(forTier(tier), {
      github: pr.github,
      payload,
      env: { RUNNER_TEMP: runnerTemp },
    });

  it("reconciles against the PR's labels, not the payload's", async () => {
    // Another run for this PR swapped risk:high for risk:medium after this
    // event fired. Reconciling against the payload asked GitHub to remove a
    // label that was already gone.
    const pr = pullRequest(["risk:medium"]);
    await label(pr, "medium", ["risk:high"]);
    assert.deepEqual(pr.state.removals, []);
    assert.deepEqual(sorted(pr.state.labels), ["risk:medium"]);
  });

  it("never leaves a lower tier standing because the payload listed this one", async () => {
    // The quieter half of the same bug. The payload still lists risk:high, so
    // the old code skipped adding it — and never removed risk:low, which the
    // payload didn't list — leaving a high-risk PR labelled low.
    const pr = pullRequest(["risk:low"]);
    await label(pr, "high", ["risk:high"]);
    assert.deepEqual(sorted(pr.state.labels), ["risk:high"]);
  });

  it("treats a label removed between the read and the write as removed", async () => {
    const pr = pullRequest(["risk:low"], {
      onRemove: (name, state) => state.labels.delete(name),
    });
    await label(pr, "high", ["risk:low"]);
    assert.deepEqual(pr.state.removals, ["risk:low"]);
    assert.deepEqual(sorted(pr.state.labels), ["risk:high"]);
  });

  it("still fails on anything but a 404", async () => {
    const pr = pullRequest(["risk:low"], {
      onRemove: () => {
        throw httpError(502, "Bad Gateway");
      },
    });
    await assert.rejects(label(pr, "high", ["risk:low"]), { status: 502 });
  });

  it("leaves every label that is not a risk tier alone", async () => {
    const pr = pullRequest(["risk:low", "reviewed:deep", "dependencies"]);
    await label(pr, "high", ["risk:low", "reviewed:deep", "dependencies"]);
    assert.deepEqual(sorted(pr.state.labels), [
      "dependencies",
      "reviewed:deep",
      "risk:high",
    ]);
  });
});

/**
 * A bash that runs the Gate the way a Linux runner would, or null.
 *
 * On Windows the `bash` on PATH is often WSL's, which runs in another OS and
 * cannot see this process's paths, so there only an MSYS one counts — the
 * `bash` on PATH if it is one, else the one beside `git` (Git for Windows
 * ships it). CI runs Linux and macOS, where the first candidate always works;
 * the skip below is a concession to a local Windows checkout, never to CI.
 */
async function findBash() {
  const candidates = ["bash"];
  if (process.platform === "win32") {
    try {
      const { stdout } = await run("git", ["--exec-path"]);
      // <git>/mingw64/libexec/git-core → <git>/bin/bash.exe
      candidates.push(resolve(stdout.trim(), "../../../bin/bash.exe"));
    } catch {
      // No git on PATH: nothing to derive a bash from.
    }
  }
  for (const candidate of candidates) {
    try {
      const { stdout } = await run(candidate, ["-c", "uname -s"]);
      if (process.platform !== "win32" || /^(MINGW|MSYS)/.test(stdout)) {
        return candidate;
      }
    } catch {
      // Not there, or not runnable: try the next one.
    }
  }
  return null;
}

const bash = await findBash();

describe(
  "the gate on the push that changes the head",
  {
    skip:
      !bash && "no MSYS or POSIX bash to run the Gate under — CI runs these",
  },
  () => {
    let dir;
    before(async () => {
      dir = await mkdtemp(join(tmpdir(), "pr-risk-gate-"));
      // The rubric's part is not under test here — `pr-risk.test.mjs` owns
      // that. This one prints the flags the Gate passed it, which is the whole
      // of the Gate's decision.
      await writeFile(
        join(dir, "rubric.mjs"),
        "console.log(JSON.stringify(process.argv.slice(2)));\n",
      );
      await writeFile(join(dir, "gate.sh"), stepBlock("Gate", "run"));
    });
    after(async () => {
      await rm(dir, { recursive: true, force: true, maxRetries: 3 });
    });

    /** The flags the rubric was run with, or null if the Gate never ran it. */
    async function gate({ action, labels, body = "" }) {
      // `bash -e`: what a runner uses for a `run:` step with no `shell:`.
      const { stdout } = await run(bash, ["-e", join(dir, "gate.sh")], {
        env: {
          ...process.env,
          EVENT_ACTION: action,
          LABELS: labels.join(","),
          PR_TITLE: "ci: a title",
          PR_BODY: body,
          RUBRIC: join(dir, "rubric.mjs"),
          DIFF_REF: "main",
          GITHUB_WORKSPACE: dir,
        },
      });
      const line = stdout.split(/\r?\n/).find((l) => l.startsWith("["));
      return { stdout, flags: line ? JSON.parse(line) : null };
    }

    it("does not count a reviewed:deep that was on the PR before the push", async () => {
      // The payload of a `synchronize` still lists the label the first step
      // just removed. Counting it let a force-pushed tree keep the review its
      // predecessor earned — on a fork, where nothing removes it, indefinitely.
      const { stdout, flags } = await gate({
        action: "synchronize",
        labels: ["risk:high", "reviewed:deep"],
      });
      assert.ok(flags, "the Gate should have run the rubric");
      assert.ok(
        flags.includes("--gate") && !flags.includes("--reviewed"),
        `expected --gate without --reviewed, got ${JSON.stringify(flags)}`,
      );
      assert.match(stdout, /::notice::Not counting reviewed:deep/);
    });

    it("counts it on the events that re-run the check without a push", async () => {
      // The other half, and the one a fix could most easily break: `labeled`
      // is how a reviewed:deep applied after the push turns the check green.
      // `reopened` is left out on purpose — a closed PR's branch can move
      // without a `synchronize`, so whether a label should survive it is an
      // open question this file has no business answering by accident.
      for (const action of ["labeled", "unlabeled", "edited", "opened"]) {
        const { flags } = await gate({
          action,
          labels: ["risk:high", "reviewed:deep"],
        });
        assert.ok(
          flags?.includes("--reviewed"),
          `on ${action}: expected --reviewed, got ${JSON.stringify(flags)}`,
        );
      }
    });

    it("does not accept a risk-override that was on the PR before the push", async () => {
      const { flags } = await gate({
        action: "synchronize",
        labels: ["risk-override"],
        body: "risk-override: the workflow edit is a comment typo",
      });
      assert.ok(flags, "the Gate should have graded rather than waived");
      assert.ok(!flags.includes("--reviewed"));
    });

    it("accepts it when applied after the push, reason and all", async () => {
      const { stdout, flags } = await gate({
        action: "labeled",
        labels: ["risk-override"],
        body: "risk-override: the workflow edit is a comment typo",
      });
      assert.equal(flags, null, "the override should have skipped the rubric");
      assert.match(stdout, /risk-override accepted/);
    });
  },
);
