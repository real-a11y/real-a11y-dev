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
// The same snapshot is how the Gate used to decide whether a review label
// counted, which it cannot answer: an `edited` fired between a push and the
// step dropping the old `reviewed:deep` still listed it, and on a fork nothing
// dropped it at all. So most cases here fire events at an imaginary pull
// request the way GitHub does — titling each run from the workflow's own
// `run-name`, snapshotting the labels into its payload — and then execute
// those runs late, twice, out of order, or never.
//
// THE REAL STEPS, NOT A TRANSCRIPTION. Each case lifts its step's script out of
// the workflow file and runs it: a `github-script` body the way that action
// does — the body of an async function handed `github`, `context`, `core` and
// `require` — against an in-memory pull request, and the Gate's `run:` under
// bash against a stub rubric that reports the flags it was given, in the
// environment the Gate's own `env:` builds. Logic copied into this file would
// keep passing while the workflow drifted; lifting it means editing the step is
// editing what is tested.
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
 * The lines of the step named `name`, from its `- name:` line to the next line
 * indented no deeper than that dash.
 *
 * A YAML parser would be a dependency, and this file has none. The workflow is
 * regular enough for indentation to answer it. A step that has been renamed or
 * reshaped fails here, loudly, rather than leaving the cases below testing
 * nothing.
 */
function stepLines(name) {
  const lines = WORKFLOW.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  assert.notEqual(
    start,
    -1,
    `pr-risk.yml has no step named "${name}". If it was renamed, rename it here too.`,
  );
  const end = lines.findIndex(
    (line, i) =>
      i > start && line.trim() && indentOf(line) <= indentOf(lines[start]),
  );
  return lines.slice(start, end === -1 ? undefined : end);
}

const indentOf = (line) => line.search(/\S/);

/** The lines nested under `key:` in the step named `name`. */
function stepKey(name, key) {
  const lines = stepLines(name);
  const at = lines.findIndex((line) => line.trim() === key);
  assert.notEqual(at, -1, `step "${name}" has no \`${key}\``);
  const body = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() && indentOf(line) <= indentOf(lines[at])) break;
    body.push(line);
  }
  return body;
}

/** The block scalar under `key` (`script` or `run`) in the step named `name`. */
function stepBlock(name, key) {
  const body = stepKey(name, `${key}: |`);
  const margin = Math.min(
    ...body.filter((line) => line.trim()).map((line) => indentOf(line)),
  );
  return body.map((line) => line.slice(margin)).join("\n");
}

/**
 * The `env:` of the step named `name`, as written: `[[NAME, value], …]`.
 *
 * Each value must be one bare `${{ }}` expression, which is all the Gate uses.
 * A literal, a quoted value or a trailing comment fails here rather than being
 * read wrong — teach this function, then.
 */
function stepEnv(name) {
  return stepKey(name, "env:")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const match = line.match(/^([A-Z][A-Z0-9_]*): (\$\{\{[^}]*\}\})$/);
      assert.ok(match, `can't read \`${line}\` in the env of step "${name}"`);
      return [match[1], match[2]];
    });
}

/** A top-level key holding one double-quoted line — `run-name`. */
function topLevel(key) {
  const line = WORKFLOW.split(/\r?\n/).find((l) => l.startsWith(`${key}: `));
  assert.ok(line, `pr-risk.yml has no top-level \`${key}\``);
  return JSON.parse(line.slice(key.length + 2));
}

/**
 * `${{ }}` filled in the way Actions does it, for the two forms this workflow
 * uses where these cases read it: a property path, and
 * `join(<path>.*.<key>, '<separator>')`. A missing value is empty, as it is in
 * Actions. Any other expression throws — teach it here rather than let a case
 * pass on something it never evaluated.
 */
function evaluate(template, context) {
  const lookup = (path) =>
    path.split(".").reduce((value, key) => value?.[key], context);
  return template.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, expr) => {
    const join = expr.match(/^join\(([\w.-]+)\.\*\.([\w-]+), '([^']*)'\)$/);
    if (join) {
      const [, path, key, separator] = join;
      return (lookup(path) ?? []).map((item) => item[key]).join(separator);
    }
    if (/^[\w.-]+$/.test(expr)) return String(lookup(expr) ?? "");
    throw new Error(`this test can't evaluate \${{ ${expr} }}`);
  });
}

/** Octokit's RequestError, as far as the steps look at it: a `status`. */
const httpError = (status, message) =>
  Object.assign(new Error(message), { status });

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

/**
 * Run a `github-script` body as the action does.
 *
 * `process` and `console` are passed too, shadowing the real ones, so a case
 * can point RUNNER_TEMP somewhere without touching this process's environment
 * and without the step's logging landing in the test report.
 */
function runScript(body, { github, context, core = {}, env = {} }) {
  assert.doesNotMatch(
    body,
    /\$\{\{/,
    "an expression the test has not substituted is still in the script",
  );
  const step = new AsyncFunction(
    "require",
    "github",
    "context",
    "core",
    "process",
    "console",
    body,
  );
  return step(require, github, context, core, { env }, { log() {} });
}

const sorted = (labels) => [...labels].sort();

const OWNER = "real-a11y";
const REPO = "real-a11y-dev";

// ---------------------------------------------------------------------------
// The record a run leaves, and which commit a review label describes
// ---------------------------------------------------------------------------

// Read where they are used rather than here, so a workflow without them fails
// the cases that need them instead of every case in the file.
const runName = () => topLevel("run-name");
const bindStep = () => stepBlock("Bind review labels to the head", "script");

const NUMBER = 7;
const [A, B] = ["a", "b"].map((c) => c.repeat(40));

/**
 * An imaginary pull request, the runs this workflow has made for it, and the
 * slice of Octokit the Bind step calls — answering the way GitHub does: 404 for
 * removing a label the PR does not have, and the run listing oldest first.
 *
 * Every event goes through `fire`, which does what GitHub does on one: titles a
 * run by evaluating the workflow's own `run-name` against the event, stamps the
 * run with the head, and snapshots the labels into the payload. Nothing runs
 * until a case hands that event to `bind` — late, twice, or never — which is
 * the whole point: these cases are about runs that execute after the pull
 * request has moved on under them.
 *
 * `fork` puts the head in another repository, where the token is read-only;
 * `"deleted"` is a fork that no longer exists, which GitHub reports as null.
 * `onRemove(name, state)` runs before each removal, so a case can stand in for
 * another run getting there first (delete the label) or GitHub failing (throw).
 */
function simulate({ fork = false, onRemove } = {}) {
  const headRepo =
    fork === "deleted" ? null : fork ? `someone/${REPO}` : `${OWNER}/${REPO}`;
  const asRepo = () => headRepo && { full_name: headRepo };
  const state = {
    head: A,
    labels: new Set(["risk:high"]),
    runs: [],
    removals: [],
    listings: 0,
  };
  const asLabels = () => [...state.labels].map((name) => ({ name }));
  const head = () => ({
    sha: state.head,
    ref: "topic",
    repo: asRepo(),
  });

  /**
   * A run GitHub made, as its listing returns it. `display_title` may be a
   * function of the run's id, which GitHub assigns before it titles the run.
   */
  function made({ display_title, ...run }) {
    const n = state.runs.length;
    const id = 37_000_000 + n;
    state.runs.push({
      id,
      run_number: 1_400 + n,
      event: "pull_request",
      head_sha: state.head,
      head_repository: asRepo(),
      display_title:
        typeof display_title === "function" ? display_title(id) : display_title,
      ...run,
    });
    return state.runs.at(-1);
  }

  function fire(action, label) {
    const payload = {
      action,
      ...(label && { label: { name: label } }),
      pull_request: {
        number: NUMBER,
        title: "ci: a title",
        body: "",
        created_at: "2026-10-08T00:00:00Z",
        head: head(),
        labels: asLabels(),
      },
    };
    const title = (id) =>
      evaluate(runName(), { github: { event: payload, run_id: id } });
    return { payload, run: made({ display_title: title }) };
  }

  return {
    state,
    push(sha) {
      state.head = sha;
      return fire("synchronize");
    },
    label(name) {
      state.labels.add(name);
      return fire("labeled", name);
    },
    unlabel(name) {
      state.labels.delete(name);
      return fire("unlabeled", name);
    },
    edit: () => fire("edited"),
    reopen: () => fire("reopened"),
    /**
     * The head moves and no run is made: pushed while the PR was closed, or by
     * a token whose events trigger no workflow.
     */
    move(sha) {
      state.head = sha;
    },
    /** A run GitHub made for something other than this pull request's events. */
    made,
    github: {
      rest: {
        pulls: {
          get: async () => ({ data: { head: head(), labels: asLabels() } }),
        },
        actions: {
          listWorkflowRuns: async ({ workflow_id, event, head_sha }) => {
            assert.equal(workflow_id, "pr-risk.yml");
            state.listings++;
            // Oldest first. GitHub lists newest first — except that two runs
            // made in the same second can come back either way round, as
            // #494's 1423 and 1424 did. A step trusting the order would be
            // right nearly always; this makes it wrong every time instead.
            const workflow_runs = state.runs.filter(
              (r) =>
                (!event || r.event === event) &&
                (!head_sha || r.head_sha === head_sha),
            );
            return {
              data: { total_count: workflow_runs.length, workflow_runs },
            };
          },
        },
        issues: {
          removeLabel: async ({ name }) => {
            state.removals.push(name);
            onRemove?.(name, state);
            if (!state.labels.delete(name)) {
              throw httpError(404, "Label does not exist");
            }
            return { data: asLabels() };
          },
        },
      },
      // Octokit unwraps the one array a list response carries.
      paginate: async (method, params) => {
        const { data } = await method(params);
        return Array.isArray(data) ? data : data.workflow_runs;
      },
    },
  };
}

/** Execute `event`'s run of the Bind step: its outputs, and what it noticed. */
async function bind(pr, { payload, run: made }) {
  const outputs = {};
  const notices = [];
  await runScript(bindStep(), {
    github: pr.github,
    context: {
      repo: { owner: OWNER, repo: REPO },
      issue: { number: NUMBER },
      payload,
      runId: made.id,
      runNumber: made.run_number,
    },
    core: {
      setOutput: (name, value) => {
        outputs[name] = value;
      },
      notice: (message) => notices.push(message),
    },
  });
  return { ...outputs, notices };
}

describe("the record each run leaves", () => {
  it("carries nothing a pull request's author writes", () => {
    // The Bind step reads run titles back as the record of which label was
    // applied at which commit. A PR title in `run-name` would let its author
    // title an `edited` run `PR risk #7 labeled reviewed:deep`. These are set
    // by GitHub, or by someone with triage access.
    const fields = [...runName().matchAll(/\$\{\{\s*(.*?)\s*\}\}/g)].map(
      ([, expr]) => expr,
    );
    const allowed = [
      "github.event.pull_request.number",
      "github.event.action",
      "github.event.label.name",
      "github.run_id",
    ];
    assert.ok(fields.length, "run-name should carry the event");
    for (const field of fields) {
      assert.ok(
        allowed.includes(field),
        `run-name carries ${field}; if GitHub alone sets it, allow it here`,
      );
    }
  });

  it("names its own run, which no title written beforehand can", () => {
    // Without the id, any run made with no `run-name` — all of them before
    // this workflow had one — would be titled with the PR title, and its
    // author can write `PR risk #7 labeled reviewed:deep` there.
    assert.ok(runName().includes("${{ github.run_id }}"));
  });
});

describe("which commit a review label describes", () => {
  it("does not count a review from before the push, whatever event the run is for", async () => {
    // `git push && gh pr edit --body …`. The `edited` payload still lists the
    // review applied at the old head, and its run cancels the `synchronize`
    // one before that gets to take it off — see `concurrency`. Before, the
    // Gate counted it on anything but `synchronize`, and the label stayed.
    const pr = simulate();
    await bind(pr, pr.label("reviewed:deep"));
    pr.push(B); // cancelled before it ran
    const edited = pr.edit();
    assert.ok(
      edited.payload.pull_request.labels.some(
        (l) => l.name === "reviewed:deep",
      ),
      "the case needs a payload that still lists the old review",
    );

    const { reviewed } = await bind(pr, edited);
    assert.equal(reviewed, "false");
    assert.deepEqual(sorted(pr.state.labels), ["risk:high"]);
  });

  it("does not count it on a fork, where nothing can take it off", async () => {
    // A fork's token is read-only, so the label stays on the PR for good —
    // and every later payload lists it. The author pushes, edits the
    // description, and used to get a green check on a commit nobody reviewed.
    const pr = simulate({ fork: true });
    await bind(pr, pr.label("reviewed:deep"));
    await bind(pr, pr.push(B));

    const { reviewed, notices } = await bind(pr, pr.edit());
    assert.equal(reviewed, "false");
    assert.deepEqual(pr.state.removals, [], "a fork's token can't remove it");
    assert.ok(pr.state.labels.has("reviewed:deep"));
    assert.match(notices.join("\n"), /Not counting reviewed:deep .* remove it/);
  });

  it("counts a review applied at this commit on every event after it", async () => {
    // The persistence a payload-only rule can't give: `edited` and a label
    // nobody gates on don't re-fire the `labeled` run, so whether the review
    // still counts has to come from somewhere that outlives it.
    const pr = simulate();
    await bind(pr, pr.push(B));
    assert.equal((await bind(pr, pr.label("reviewed:deep"))).reviewed, "true");
    for (const event of [
      pr.edit(),
      pr.label("dependencies"),
      pr.unlabel("dependencies"),
    ]) {
      assert.equal(
        (await bind(pr, event)).reviewed,
        "true",
        event.run.display_title,
      );
    }
    assert.deepEqual(pr.state.removals, []);
  });

  it("counts a review whose own run was cancelled before it ran", async () => {
    // #494's own `labeled reviewed:deep` run (1423) was cancelled within two
    // seconds by the run for a `risk:medium` label applied in the same second
    // (1424), and never ran a step — so a record that run had to write would
    // not exist. Its title and head do.
    const pr = simulate();
    await bind(pr, pr.push(B));
    pr.label("reviewed:deep"); // cancelled before it ran
    assert.equal((await bind(pr, pr.label("risk:medium"))).reviewed, "true");
  });

  it("keeps a review applied since, when an old `synchronize` run is re-run", async () => {
    // The sweep used to read the payload, and a re-run replays the original:
    // re-running the push's run after the new head had been reviewed took the
    // fresh review straight back off.
    const pr = simulate();
    await bind(pr, pr.label("reviewed:deep"));
    const push = pr.push(B);
    await bind(pr, push);
    assert.ok(!pr.state.labels.has("reviewed:deep"), "the push owes a review");
    await bind(pr, pr.label("reviewed:deep"));

    const rerun = await bind(pr, push); // `gh run rerun`: same run, same payload
    assert.equal(rerun.reviewed, "true");
    assert.deepEqual(pr.state.removals, ["reviewed:deep"]);
    assert.ok(pr.state.labels.has("reviewed:deep"));
  });

  it("does not count a review on a `reopened` whose branch moved while the PR was closed", async () => {
    // Nothing fires `synchronize` on a closed pull request, so the old sweep
    // never saw the head change, and the Gate counted the label.
    const pr = simulate();
    await bind(pr, pr.label("reviewed:deep"));
    pr.move(B);

    const { reviewed } = await bind(pr, pr.reopen());
    assert.equal(reviewed, "false");
    assert.ok(!pr.state.labels.has("reviewed:deep"));
  });

  it("neither counts nor removes a newer commit's review from a run for an older one", async () => {
    // An `edited` at A that executes only after the head moved to B and B was
    // reviewed. The PR keeps B's review; A's check, which is what this run
    // reports on, does not get it.
    const pr = simulate();
    const late = pr.edit();
    await bind(pr, pr.push(B));
    await bind(pr, pr.label("reviewed:deep"));

    const { reviewed, notices } = await bind(pr, late);
    assert.equal(reviewed, "false");
    assert.ok(pr.state.labels.has("reviewed:deep"));
    assert.match(notices.join("\n"), /moved on to bbbbbbb/);
  });

  it("gives a commit pushed back after moving away its review back", async () => {
    // By commit, not by push: the same commit is the same tree, and the
    // review was of exactly that. On a fork, so nothing took the label off in
    // between.
    const pr = simulate({ fork: true });
    await bind(pr, pr.label("reviewed:deep"));
    assert.equal((await bind(pr, pr.push(B))).reviewed, "false");
    assert.equal((await bind(pr, pr.push(A))).reviewed, "true");
  });

  it("counts a review from when it last went on", async () => {
    const pr = simulate();
    await bind(pr, pr.push(B));
    await bind(pr, pr.label("reviewed:deep"));
    assert.equal(
      (await bind(pr, pr.unlabel("reviewed:deep"))).reviewed,
      "false",
    );
    assert.equal((await bind(pr, pr.label("reviewed:deep"))).reviewed, "true");
  });

  it("reads the runs newest first, however the listing orders them", async () => {
    // Applied, removed, then put back by something that makes no run — a
    // token whose events trigger no workflow. The newest word on the label is
    // the removal. Read in listing order (oldest first, here), the first word
    // found is the application.
    const pr = simulate();
    await bind(pr, pr.push(B));
    pr.label("reviewed:deep");
    pr.unlabel("reviewed:deep");
    pr.state.labels.add("reviewed:deep");

    assert.equal((await bind(pr, pr.edit())).reviewed, "false");
  });

  it("does not count a label no run saw applied", async () => {
    // A label put on by a token whose events trigger no workflow leaves no
    // run behind, so nothing says which commit it was meant for.
    const pr = simulate();
    await bind(pr, pr.push(B));
    pr.state.labels.add("reviewed:deep");

    assert.equal((await bind(pr, pr.edit())).reviewed, "false");
    assert.ok(!pr.state.labels.has("reviewed:deep"));
  });

  it("does not count a label that is off the PR, whatever its runs say", async () => {
    // The `labeled` run executing after the label came off again — by a
    // person, whose `unlabeled` run supersedes this one, or by this step in
    // another run, which makes no run at all.
    const pr = simulate();
    await bind(pr, pr.push(B));
    const labelled = pr.label("reviewed:deep");
    pr.state.labels.delete("reviewed:deep");

    assert.equal((await bind(pr, labelled)).reviewed, "false");
  });

  it("listens to no run made for another repository or pull request", async () => {
    // The same commit, titled as if it were this PR's review — but from
    // another fork's copy of the branch, whose own (edited) workflow can
    // title its runs anything; and from another PR at the same commit.
    const pr = simulate({ fork: true });
    await bind(pr, pr.label("reviewed:deep"));
    pr.push(B);
    pr.made({
      head_repository: { full_name: `elsewhere/${REPO}` },
      display_title: (id) =>
        `PR risk #${NUMBER} labeled reviewed:deep (run ${id})`,
    });
    pr.made({
      display_title: (id) =>
        `PR risk #${NUMBER + 1} labeled reviewed:deep (run ${id})`,
    });

    assert.equal((await bind(pr, pr.edit())).reviewed, "false");
  });

  it("trusts no run title a pull request's author could have written", async () => {
    // A run made with no `run-name` — every run before the workflow had one —
    // is titled with the PR title. A fork's author retitles the PR to look
    // like a review at the commit they mean to push back later, and leaves
    // the run behind; then the PR is reviewed at another commit and they push
    // that one back. The record their title forged can't name its own run id,
    // which GitHub assigns after the title is written. Nor can a guess.
    const pr = simulate({ fork: true });
    pr.made({ display_title: `PR risk #${NUMBER} labeled reviewed:deep` });
    pr.made({
      display_title: (id) =>
        `PR risk #${NUMBER} labeled reviewed:deep (run ${id + 1})`,
    });
    await bind(pr, pr.push(B));
    await bind(pr, pr.label("reviewed:deep"));

    assert.equal((await bind(pr, pr.push(A))).reviewed, "false");
  });

  it("still reads a pull request whose fork was deleted", async () => {
    // GitHub reports the head repository as null then, on the PR and on its
    // runs alike, and the two must still match each other.
    const pr = simulate({ fork: "deleted" });
    await bind(pr, pr.push(B));
    await bind(pr, pr.label("reviewed:deep"));
    assert.equal((await bind(pr, pr.edit())).reviewed, "true");
  });

  it("binds risk-override the same way", async () => {
    const pr = simulate();
    assert.equal((await bind(pr, pr.label("risk-override"))).override, "true");
    pr.push(B);

    const { override } = await bind(pr, pr.edit());
    assert.equal(override, "false");
    assert.ok(!pr.state.labels.has("risk-override"));
  });

  it("reads no run history when no gate label is on the PR", async () => {
    const pr = simulate();
    const outputs = await bind(pr, pr.push(B));
    assert.equal(outputs.reviewed, "false");
    assert.equal(outputs.override, "false");
    assert.equal(pr.state.listings, 0);
  });

  it("treats a label an earlier run already removed as removed", async () => {
    // A stack force-push fires `synchronize` twice, a second apart, and both
    // runs find the review stale. The second one's removal is a 404.
    const pr = simulate({
      onRemove: (name, state) => state.labels.delete(name),
    });
    pr.label("reviewed:deep");
    pr.push(B);

    const { reviewed, notices } = await bind(pr, pr.edit());
    assert.equal(reviewed, "false");
    assert.deepEqual(pr.state.removals, ["reviewed:deep"]);
    assert.match(
      notices.join("\n"),
      /^Another run already removed reviewed:deep/m,
    );
  });

  it("still fails on anything but a 404", async () => {
    // The Gate refuses the label either way, but a token that can't write
    // labels, or GitHub having a bad minute, should be loud: a stale review
    // left standing still tells whoever reads the PR the head was reviewed.
    const pr = simulate({
      onRemove: () => {
        throw httpError(403, "Resource not accessible by integration");
      },
    });
    pr.label("reviewed:deep");
    pr.push(B);

    await assert.rejects(bind(pr, pr.edit()), { status: 403 });
  });
});

// ---------------------------------------------------------------------------
// The risk label
// ---------------------------------------------------------------------------

/**
 * A pull request's labels and comments behind the slice of Octokit the Label
 * and report step calls, answering the way GitHub does: 404 for removing a
 * label the PR does not have, 422 for creating one the repo already has.
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

  /** `payload` is the label list the event carried, apart from the PR's own. */
  const label = (pr, tier, payload) =>
    runScript(forTier(tier), {
      github: pr.github,
      context: {
        repo: { owner: OWNER, repo: REPO },
        issue: { number: 1 },
        payload: {
          pull_request: { labels: payload.map((name) => ({ name })) },
        },
      },
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

// ---------------------------------------------------------------------------
// The Gate
// ---------------------------------------------------------------------------

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
  "the Gate",
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

    /**
     * What the Gate passed the rubric after `--gate` — `[]` for nothing, null
     * if it never ran the rubric — for an event carrying `payload`, after a
     * Bind step that set `outputs`. The environment is the one the Gate's own
     * `env:` builds from those, as Actions would.
     */
    async function gate(payload, outputs) {
      const context = {
        github: { event: payload },
        steps: {
          bind: { outputs },
          classify: {
            outputs: { rubric: join(dir, "rubric.mjs"), diff_ref: "main" },
          },
        },
      };
      const env = Object.fromEntries(
        stepEnv("Gate").map(([name, value]) => [
          name,
          evaluate(value, context),
        ]),
      );
      // `bash -e`: what a runner uses for a `run:` step with no `shell:`.
      const { stdout } = await run(bash, ["-e", join(dir, "gate.sh")], {
        env: { ...process.env, ...env, GITHUB_WORKSPACE: dir },
      });
      const line = stdout.split(/\r?\n/).find((l) => l.startsWith("["));
      if (!line) return null;
      const flags = JSON.parse(line);
      return flags.slice(flags.lastIndexOf("--gate") + 1);
    }

    /** The payload of an `action` event whose PR carries `labels`. */
    const payload = (action, labels, body = "") => ({
      action,
      pull_request: {
        title: "ci: a title",
        body,
        labels: labels.map((name) => ({ name })),
      },
    });

    it("never counts a reviewed:deep because the payload lists it", async () => {
      // Every payload after a push lists the review from before it until
      // something takes it off, and on a fork nothing does. Read as-is, it
      // handed a new head the green gate the previous one earned — on any
      // event but `synchronize`, which was the only one it refused.
      for (const action of [
        "edited",
        "labeled",
        "unlabeled",
        "opened",
        "reopened",
        "synchronize",
      ]) {
        const flags = await gate(
          payload(action, ["risk:high", "reviewed:deep"]),
          { reviewed: "false", override: "false" },
        );
        assert.deepEqual(flags, [], `on ${action}`);
      }
    });

    it("never accepts a risk-override because the payload lists it", async () => {
      for (const action of ["edited", "labeled", "synchronize"]) {
        const flags = await gate(
          payload(action, ["risk-override"], "risk-override: a comment typo"),
          { reviewed: "false", override: "false" },
        );
        assert.deepEqual(flags, [], `on ${action}`);
      }
    });

    it("counts a review the Bind step found applied at this commit", async () => {
      // On any event, and whatever the payload says: a `labeled` run that was
      // cancelled leaves the next event's run to turn the check green.
      for (const action of ["labeled", "edited", "unlabeled", "synchronize"]) {
        const flags = await gate(payload(action, []), {
          reviewed: "true",
          override: "false",
        });
        assert.deepEqual(flags, ["--reviewed"], `on ${action}`);
      }
    });

    it("hands a counted override to the rubric, which reads the reason back", async () => {
      // Not waived here. The rubric — the base branch's — refuses a missing
      // reason, and waives only the rules a reason line names, which this
      // step's own check skipped: `risk-override: ci-workflows — …` waived
      // every rule that fired.
      const flags = await gate(
        payload(
          "labeled",
          ["risk-override"],
          "risk-override: packaging — a version bump",
        ),
        { reviewed: "false", override: "true" },
      );
      assert.deepEqual(flags, ["--override"]);
    });

    it("does not pass an override a counted review makes moot", async () => {
      // The rubric weighs a narrowed override before `--reviewed`, and would
      // refuse a reviewed PR whose override names too few rules.
      const flags = await gate(payload("edited", []), {
        reviewed: "true",
        override: "true",
      });
      assert.deepEqual(flags, ["--reviewed"]);
    });

    it("counts nothing but exactly true", async () => {
      // An output that never got set arrives empty, and has to read as "not
      // reviewed" rather than as anything else.
      for (const value of ["", "True", "1", " true", "false"]) {
        const flags = await gate(payload("labeled", ["reviewed:deep"]), {
          reviewed: value,
          override: value,
        });
        assert.deepEqual(flags, [], JSON.stringify(value));
      }
    });

    describe("from event to verdict", () => {
      /** The Bind step for `event`'s run, then the Gate on what it found. */
      const verdict = async (pr, event) =>
        gate(event.payload, await bind(pr, event));

      it("gives a push and an edit together no review from before the push", async () => {
        for (const fork of [false, true]) {
          const pr = simulate({ fork });
          assert.deepEqual(
            await verdict(pr, pr.label("reviewed:deep")),
            ["--reviewed"],
            "the review counts for the commit it was applied at",
          );
          pr.push(B); // cancelled before it ran — or, on a fork, harmless
          assert.deepEqual(
            await verdict(pr, pr.edit()),
            [],
            fork ? "on a fork" : "in the repo",
          );
        }
      });

      it("goes green on a review of the new head, and stays green", async () => {
        const pr = simulate();
        await verdict(pr, pr.label("reviewed:deep"));
        assert.deepEqual(await verdict(pr, pr.push(B)), []);
        assert.deepEqual(await verdict(pr, pr.label("reviewed:deep")), [
          "--reviewed",
        ]);
        assert.deepEqual(await verdict(pr, pr.edit()), ["--reviewed"]);
      });
    });
  },
);
