// What the rubric grades, asserted rather than described.
//
//   pnpm test:scripts                        all of them (and part of `pnpm verify`)
//   node --test scripts/pr-risk.test.mjs     just this file
//
// `test:scripts` is `cd scripts && node --test`, and the `cd` is load-bearing:
// `node --test <dir>` scans that directory on Node 20 but treats it as a FILE TO
// RUN from Node 21 on, so the tidier-looking `node --test scripts/` died with
// `Cannot find module …/scripts` on the CI matrix's Node 22 legs while passing
// every local run and both Node 20 legs. With no positional argument, every
// version discovers test files under the working directory the same way.
//
// BLACK BOX, on purpose. `pr-risk.mjs` is a script, not a module — it collects
// facts and prints at import time — so there is nothing to import and stub. Each
// case therefore builds a throwaway git repository, commits a base, commits a
// diff on top, and runs the real rubric against it with `--repo`. That is the
// same entry point `.github/workflows/pr-risk.yml` uses, so a case passing here
// is a case that passes in CI rather than one that passes against a seam.
//
// It also means these tests cost git processes, not microseconds. Keep the cases
// few and make each one carry a decision somebody could otherwise silently
// reverse — the point is that a classification cannot be deleted without a red
// test, not that every path in the rubric has a row here.
//
// Node's own test runner, and node core only: this file sits in the tree that
// `pr-risk.yml` extracts and runs with no `pnpm install`, and a devDependency
// import here would be one more thing that can break that job.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const RUBRIC = fileURLToPath(new URL("./pr-risk.mjs", import.meta.url));

/**
 * The environment with git's repo-location variables STRIPPED.
 *
 * This bit once, and the mechanism has not gone anywhere. `pnpm verify` ran from
 * the `pre-push` hook, git exports `GIT_DIR` and `GIT_INDEX_FILE` into a hook's
 * environment, and those beat `cwd` — so every `git init` here silently
 * addressed the real repository instead of its own temp directory, and the whole
 * suite died on `fatal: this operation must be run in a work tree`. Green from a
 * plain shell, red from the hook: the one place a fixture must not inherit
 * ambient state. The hook is `format:check` and `lint` only now, so it no longer
 * reaches these tests — but anything invoked from a hook, or a shell that
 * exports these by hand, reproduces it exactly, and the failure mode is a
 * fixture writing to the real repository.
 *
 * The identity pairs go too. `GIT_AUTHOR_NAME` and friends outrank the `-c`
 * flags below, so a contributor who exports them would otherwise author these
 * throwaway commits.
 */
const HERMETIC_ENV = { ...process.env };
for (const name of [
  "GIT_DIR",
  "GIT_COMMON_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CEILING_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_DATE",
]) {
  delete HERMETIC_ENV[name];
}

/** A repo whose config cannot depend on whose machine is running the suite. */
async function git(cwd, args) {
  await run(
    "git",
    [
      "-c",
      "user.name=pr-risk test",
      "-c",
      "user.email=pr-risk@example.invalid",
      "-c",
      "commit.gpgsign=false",
      // Windows: without this, git rewrites line endings and warns on every
      // add, which is noise in a failure report and nothing this asserts.
      "-c",
      "core.autocrlf=false",
      ...args,
    ],
    { cwd, env: HERMETIC_ENV },
  );
}

let root;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "pr-risk-"));

  // Refuse to run if anything still redirects git, and refuse BEFORE the first
  // `git init` rather than after.
  //
  // This is not defensive dressing. `git init` under a stray `GIT_DIR`
  // REINITIALISES the repository that variable names — and with no work tree in
  // scope it writes `core.bare = true` into that repo's shared config, which for
  // a repo with linked worktrees breaks the main checkout and every worktree at
  // once, for every session using them. That is what happened here, from the
  // `pre-push` hook, before `HERMETIC_ENV` above existed.
  //
  // So the check is a probe rather than a list: stripping the variables I know
  // about cannot cover one a future git adds, but "git already resolves a
  // repository in an empty directory" catches any of them. `GIT_CEILING_DIRECTORIES`
  // stops the ordinary upward walk, so a hit means redirection and not merely a
  // temp directory that happens to sit inside a checkout — which is harmless,
  // since `git init` would create a fresh repo there rather than touch the
  // ancestor.
  let redirected = null;
  try {
    const { stdout } = await run("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: root,
      env: { ...HERMETIC_ENV, GIT_CEILING_DIRECTORIES: dirname(root) },
    });
    redirected = stdout.trim();
  } catch {
    // The expected path: a fresh temp directory is not a repository.
  }
  if (redirected) {
    throw new Error(
      `git resolves ${root} to the repository at ${redirected}. Something is ` +
        `still redirecting it, and \`git init\` would reinitialise that ` +
        `repository rather than build a fixture. Refusing to run.`,
    );
  }
});

after(async () => {
  // `maxRetries` because git may still hold a handle on Windows for a moment.
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
});

let n = 0;

/**
 * Grade a diff: `files` is what this imaginary pull request writes — an array
 * of paths (each gets placeholder content), or `{ path: content }` when the
 * rule under test reads the code rather than the path. A `null` content
 * deletes that path from `base`.
 *
 * `base` is committed first and never appears in the answer — the rubric diffs
 * against the merge base, so the base commit's own contents are invisible to it.
 * That is what lets a case name exactly the paths it is about, and it is how a
 * case edits a file rather than creating one.
 *
 * `commit: false` leaves the change in the working tree — a new file stays
 * untracked — which is what `pnpm pr:risk` sees before the author commits.
 * `config` is written into the fixture's own `.git/config`, where the rubric's
 * git calls will read it, standing in for whatever the person running it has.
 */
async function grade(files, { base = {}, commit = true, config = {} } = {}) {
  const dir = join(root, `case-${++n}`);
  await mkdir(dir, { recursive: true });

  const write = async (path, content) => {
    const file = resolve(dir, path);
    if (content === null) return rm(file);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  };

  await git(dir, ["init", "-q", "-b", "main"]);
  await write("seed", "base\n");
  for (const [path, content] of Object.entries(base)) {
    await write(path, content);
  }
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "--no-verify", "-m", "chore: seed"]);

  await git(dir, ["checkout", "-q", "-b", "topic"]);
  const changes = Array.isArray(files)
    ? files.map((path) => [path, "changed\n"])
    : Object.entries(files);
  for (const [path, content] of changes) {
    await write(path, content);
  }
  if (commit) {
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "--no-verify", "-m", "chore: change"]);
  }
  for (const [key, value] of Object.entries(config)) {
    await git(dir, ["config", key, value]);
  }

  // Same stripped environment: the rubric runs its own git with `cwd: repoRoot`,
  // and an inherited `GIT_DIR` would point every one of those reads at the repo
  // this suite happens to be running inside rather than at the fixture.
  const { stdout } = await run(
    process.execPath,
    [RUBRIC, "--repo", dir, "--base", "main", "--format", "json"],
    { maxBuffer: 16 * 1024 * 1024, env: HERMETIC_ENV },
  );
  return JSON.parse(stdout);
}

const ruleIds = (result) => result.reasons.map((r) => r.id);
const evidenceFor = (result, id) =>
  result.reasons.find((r) => r.id === id)?.evidence ?? [];

describe("agent instruction grades as review policy", () => {
  it("grades the root CLAUDE.md 🔴 high, citing it by path", async () => {
    const result = await grade(["CLAUDE.md"]);

    assert.equal(result.tier, "high");
    assert.ok(
      ruleIds(result).includes("review-policy"),
      `expected review-policy to fire, got: ${ruleIds(result).join(", ") || "no rules"}`,
    );
    assert.deepEqual(evidenceFor(result, "review-policy"), ["CLAUDE.md"]);
  });

  it("says nothing about the path being unrecognised", async () => {
    // The state this replaced: no rule matched, so CLAUDE.md fell through to
    // "paths the rubric doesn't recognise (medium until one of us classifies
    // them)" — whose printed advice is to add the path to LOW_SHAPED, i.e. to
    // the list documented as harmless. Being cited by a rule is what keeps that
    // advice off a file that is anything but.
    const result = await grade(["CLAUDE.md"]);

    assert.deepEqual(result.unrecognised, []);
    assert.ok(!result.shape.includes("unrecognised"));
  });

  it("grades a nested CLAUDE.md the same — the anchor is the basename", async () => {
    // None exists today. The rule is anchored this way because Claude Code loads
    // a nested CLAUDE.md for the subtree it sits in, with the same force as the
    // root one, so the day somebody adds `packages/extension/CLAUDE.md` it must
    // not arrive graded as an unclassified path.
    const result = await grade(["packages/extension/CLAUDE.md"]);

    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "review-policy"), [
      "packages/extension/CLAUDE.md",
    ]);
  });

  it("is not switched off by a capitalisation slip", async () => {
    // On macOS and Windows the read still resolves, so `Claude.md` keeps every
    // bit of its authority over agent sessions while a case-sensitive pattern
    // silently stops matching it. Same failure the `breaking` rule was fixed for
    // when `feat!:` fired and `Feat!:` did not.
    const result = await grade(["Claude.md"]);

    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "review-policy"), ["Claude.md"]);
    assert.equal(result.ci.code, false);
  });

  it("grades it the same as the .claude/ skills it shares authority with", async () => {
    // The reason this file's classification is worth a test at all: the two
    // carry the same kind of authority over how agents behave here, and graded
    // apart, the one that is easier to edit is the one that gets less review.
    const skill = await grade([".claude/skills/pr/SKILL.md"]);
    const claudeMd = await grade(["CLAUDE.md"]);

    assert.equal(claudeMd.tier, skill.tier);
    assert.deepEqual(ruleIds(claudeMd), ruleIds(skill));
  });
});

describe("the basename anchor does not spread", () => {
  it("leaves ordinary root docs 🟢 low", async () => {
    const result = await grade(["README.md"]);

    assert.equal(result.tier, "low");
    assert.deepEqual(result.reasons, []);
    assert.ok(result.shape.includes("root docs"));
  });

  it("leaves a doc that merely contains the word 🟢 low", async () => {
    // `(^|/)CLAUDE\.md$` rather than a bare `CLAUDE\.md`: without both anchors a
    // note about the file grades as the file.
    const result = await grade(["docs/my-CLAUDE.md", "docs/CLAUDE.md.bak.md"]);

    assert.equal(result.tier, "low");
    assert.deepEqual(result.reasons, []);
  });
});

describe("the CI axis classifies it too", () => {
  it("treats a CLAUDE.md-only diff as inert for the test matrix", async () => {
    // A different question from the tier, and both halves have to name the path:
    // 🔴 high to review, and incapable of changing what any test asserts. Left
    // out of CI_INERT it would run e2e, the example apps and Node 24 over a
    // paragraph of prose.
    const result = await grade(["CLAUDE.md"]);

    assert.equal(result.ci.code, false);
    assert.equal(result.ci.website, false);
    // "the one narrow leg", not "Node 20" — the version floor moves for reasons
    // that have nothing to do with this file, and a test that fails on that bump
    // teaches the person bumping it to edit the expectation without reading it.
    assert.equal(result.ci.matrix.node.length, 1);
  });

  it("still runs everything when real source moves alongside it", async () => {
    const result = await grade(["CLAUDE.md", "packages/core/src/index.ts"]);

    assert.equal(result.ci.code, true);
    assert.equal(result.tier, "high");
  });
});

// Trimmed to the shape of the real files. What matters is which lines sit at
// column 0, because that is what git reports as the declaration a hunk is in.
const NATIVE_TREE_PATH = "packages/browser/src/native-tree.ts";
const NATIVE_TREE = `/**
 * The native producer.
 */
const DOM_ATTR_ALLOWLIST = new Set([
  "role",
  "href",
  "placeholder",
]);

export function allowlistAttributes(flat: string[]): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (let i = 0; i + 1 < flat.length; i += 2) {
    if (DOM_ATTR_ALLOWLIST.has(flat[i])) attributes[flat[i]] = flat[i + 1];
  }
  return attributes;
}

/**
 * Build the tree from CDP's flat node list.
 */
export function buildNativeTree(nodes: RawNode[]): NativeNode[] {
  // One pass over CDP's flat list; parents arrive before their children.
  return nodes.map((node) => ({
    id: node.nodeId,
    attributes: allowlistAttributes(node.attributes ?? []),
  }));
}
`;

const DOM_EXTRACTOR_PATH = "packages/core/src/extraction/dom-extractor.ts";
const DOM_EXTRACTOR = `const SENSITIVE_AUTOCOMPLETE_TOKENS: ReadonlySet<string> = new Set([
  "current-password",
  "cc-number",
]);

export function isSensitiveField(element: Element): boolean {
  if (element.getAttribute("type") === "password") return true;
  const tokens = (element.getAttribute("autocomplete") ?? "").split(/\\s+/);
  return tokens.some((t) => SENSITIVE_AUTOCOMPLETE_TOKENS.has(t));
}

export function getDescendantText(element: Element): string {
  return element.textContent ?? "";
}
`;

/** Edit one file of the base: `[path, content, from, to]` → a graded diff. */
const gradeEdit = (path, content, from, to) => {
  assert.ok(content.includes(from), `fixture has no ${JSON.stringify(from)}`);
  return grade(
    { [path]: content.replace(from, to) },
    { base: { [path]: content } },
  );
};

describe("field-value redaction (R1) grades as a redaction boundary", () => {
  it("grades widening the native allowlist 🔴 high, though no changed line names it", async () => {
    // The shape a real leak takes. A PR here once added two entries to
    // DOM_ATTR_ALLOWLIST, and its whole diff under `-U0` was two indented
    // string literals — nothing on a changed line names the allowlist, so a
    // rule reading only changed lines cannot see it. Git's hunk header can:
    // it names the declaration the hunk sits inside. Add `"value"` here and
    // the `dom` facet carries a field's `value` attribute into CLI and MCP
    // output — which React keeps in sync with what the user typed.
    const result = await gradeEdit(
      NATIVE_TREE_PATH,
      NATIVE_TREE,
      `  "placeholder",\n`,
      `  "placeholder",\n  "value",\n`,
    );

    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "field-value-redaction"), [
      `${NATIVE_TREE_PATH} → DOM_ATTR_ALLOWLIST`,
    ]);
  });

  it("grades routing around allowlistAttributes 🔴 high — the removal side counts", async () => {
    // Same reasoning as removing a `redactUrl()` call: taking the gate out is
    // the most direct way to bring the leak back, and the only trace of it in
    // the diff is the `-` line.
    const result = await gradeEdit(
      NATIVE_TREE_PATH,
      NATIVE_TREE,
      `allowlistAttributes(node.attributes ?? [])`,
      `Object.fromEntries(pairs(node.attributes ?? []))`,
    );

    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "field-value-redaction"), [
      `${NATIVE_TREE_PATH} → allowlistAttributes`,
    ]);
  });

  it("grades an edit inside isSensitiveField 🔴 high — the DOM producer's gate", async () => {
    // Dropping the password check names nothing but the attribute it tested.
    const result = await gradeEdit(
      DOM_EXTRACTOR_PATH,
      DOM_EXTRACTOR,
      `  if (element.getAttribute("type") === "password") return true;\n`,
      ``,
    );

    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "field-value-redaction"), [
      `${DOM_EXTRACTOR_PATH} → isSensitiveField`,
    ]);
  });
});

describe("field-value redaction covers each producer's own allowlists", () => {
  it("grades literal-only edits to KEY_ATTRIBUTES and NATIVE_AX_AUTHOR_NAMED_ROLES 🔴 high", async () => {
    // The DOM producer's twin of DOM_ATTR_ALLOWLIST, and the first tier of the
    // native producer's defence against promoting a typed value into a field's
    // name. Both are string literals in a Set or array, so the hunk header is
    // the only place either name appears — the same shape as the allowlist
    // case above, one producer over.
    const keyAttrs = `export const KEY_ATTRIBUTES = [\n  "id",\n  "role",\n];\n`;
    const authorNamed = `export const NATIVE_AX_AUTHOR_NAMED_ROLES: ReadonlySet<string> = new Set([\n  "image",\n  "combobox",\n  "textbox",\n]);\n`;
    const keyAttrsPath = "packages/core/src/extraction/dom-extractor.ts";
    const authorNamedPath = "packages/core/src/native/ax-vocabulary.ts";
    const result = await grade(
      {
        [keyAttrsPath]: keyAttrs.replace(
          `  "role",\n`,
          `  "role",\n  "value",\n`,
        ),
        [authorNamedPath]: authorNamed.replace(`  "combobox",\n`, ``),
      },
      { base: { [keyAttrsPath]: keyAttrs, [authorNamedPath]: authorNamed } },
    );

    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "field-value-redaction"), [
      `${keyAttrsPath} → KEY_ATTRIBUTES`,
      `${authorNamedPath} → NATIVE_AX_AUTHOR_NAMED_ROLES`,
    ]);
  });
});

describe("field-value redaction covers the extension's page-text reads", () => {
  it("grades letting a textarea's text back into a live region or an editor 🔴 high", async () => {
    // A `<textarea>`'s child text is its markup default — for a sensitive
    // field, the secret. The live-region observer sends what it reads to the
    // panel, so either edit puts that secret on the extension's message
    // channel: dropping the tag from core's set names only the set, through
    // the hunk header, and going back to raw `textContent` names only the
    // helper it replaced.
    const textPath = "packages/core/src/extraction/dom-extractor.ts";
    const text = `const CONTROL_TEXT_TAGS: ReadonlySet<string> = new Set([\n  "select",\n  "textarea",\n  "datalist",\n]);\n`;
    const contentPath = "packages/extension/src/content.ts";
    const content = `for (const region of regions) {\n  const text = pageText(region, { announced: true }).trim();\n  send(text);\n}\n`;
    const result = await grade(
      {
        [textPath]: text.replace(`  "textarea",\n`, ``),
        [contentPath]: content.replace(
          `pageText(region, { announced: true })`,
          `(region.textContent || "")`,
        ),
      },
      { base: { [textPath]: text, [contentPath]: content } },
    );

    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "field-value-redaction"), [
      `${textPath} → CONTROL_TEXT_TAGS`,
      `${contentPath} → pageText`,
    ]);
  });
});

describe("field-value redaction covers the names around a sensitive field", () => {
  it("grades loosening core's name rule, by its renamed and new names, 🔴 high", async () => {
    // A field's value in another node's name: an empty field gives nothing
    // away, so widening "empty" withholds less, and the renamed value test
    // decides what a field holds at all. Each edit names only its gate.
    const rulePath = "packages/core/src/native/value-regions.ts";
    const rule = `export function carriesAXValue(raw) {\n  return nonEmptyAXText(raw.value?.value) !== undefined;\n}\n\nexport function givesValueAway(field, byId) {\n  return field.ignored === true || holdsContent(field, byId, false);\n}\n`;
    const result = await grade(
      {
        [rulePath]: rule
          .replace(
            "nonEmptyAXText(raw.value?.value) !== undefined",
            'typeof raw.value?.value === "string"',
          )
          .replace("field.ignored === true || ", ""),
      },
      { base: { [rulePath]: rule } },
    );

    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "field-value-redaction"), [
      `${rulePath} → carriesAXValue, givesValueAway, holdsContent`,
    ]);
  });

  it("still grades loosening the normalizer's own carriesValue 🔴 high", async () => {
    // A different function from carriesAXValue: the normalizer's rule that a
    // node holding a value never lends its text to a name.
    const normPath = "packages/core/src/native/ax-normalize.ts";
    const norm = `function carriesValue(node) {\n  return nonEmptyAXText(node.value?.value) !== undefined;\n}\n`;
    const result = await grade(
      { [normPath]: norm.replace("!== undefined", "=== null") },
      { base: { [normPath]: norm } },
    );
    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "field-value-redaction"), [
      `${normPath} → carriesValue`,
    ]);
  });

  it("grades narrowing which fields the extension hands that rule 🔴 high", async () => {
    // Drop the mask from the extension's roots, or stop looking inside a
    // target that hides an ignored node, and a password's length or a hidden
    // card's number names the node around it again.
    const corePath = "packages/extension/src/native/native-core.ts";
    const core = `function nameWithholdingRoots(rawNodes, withheld) {\n  const roots = new Set(withheld);\n  for (const raw of rawNodes) {\n    if (isNativePasswordMask(raw.value?.value)) roots.add(raw.nodeId);\n  }\n  return [...roots];\n}\n\nfunction hidesUnreadNode(target, byId, read) {\n  return target.ignored === true || anyChildIgnored(target, byId, read);\n}\n`;
    const result = await grade(
      {
        [corePath]: core
          .replace(
            "    if (isNativePasswordMask(raw.value?.value)) roots.add(raw.nodeId);\n",
            "",
          )
          .replace("target.ignored === true || ", ""),
      },
      { base: { [corePath]: core } },
    );

    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "field-value-redaction"), [
      `${corePath} → nameWithholdingRoots, isNativePasswordMask, hidesUnreadNode`,
    ]);
  });
});

describe("field-value redaction covers the extension's option picker", () => {
  it("grades marking a withheld select's current option, or naming the choice, 🔴 high", async () => {
    // A sensitive select's chosen option IS its value. Letting the picker
    // mark it, or the feedback name it, puts the value on screen: either
    // edit names only the gate it loosens.
    const gatePath = "packages/extension/src/native/native-actions.ts";
    const gate = `export function pickerCurrentOption(select, options) {\n  if (select.valueWithheld !== false) return undefined;\n  return options.find((o) => o.states?.selected === true);\n}\n`;
    const feedbackPath = "packages/extension/src/sidepanel/action-feedback.ts";
    const feedback = `export function describeSelection(field, option, valueWithheld) {\n  return valueWithheld ? \`Selected an option in \${field}\` : \`Selected: \${option}\`;\n}\n`;
    const result = await grade(
      {
        [gatePath]: gate.replace(
          "  if (select.valueWithheld !== false) return undefined;\n",
          "",
        ),
        [feedbackPath]: feedback.replace(
          "valueWithheld ? `Selected an option in ${field}` : ",
          "",
        ),
      },
      { base: { [gatePath]: gate, [feedbackPath]: feedback } },
    );

    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "field-value-redaction"), [
      `${gatePath} → pickerCurrentOption`,
      `${feedbackPath} → describeSelection`,
    ]);
  });

  it("grades shortening the states withheld inside a sensitive field 🔴 high", async () => {
    // An option's `selected` under a sensitive select names the value. Both
    // native transports read the one list, so trimming it is the leak.
    const vocabPath = "packages/core/src/native/ax-vocabulary.ts";
    const vocab = `export const NATIVE_AX_CHOICE_STATES: readonly string[] = ["selected"];\n`;
    const result = await grade(
      { [vocabPath]: vocab.replace('["selected"]', "[]") },
      { base: { [vocabPath]: vocab } },
    );

    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "field-value-redaction"), [
      `${vocabPath} → NATIVE_AX_CHOICE_STATES`,
    ]);
  });

  it("grades narrowing what a sensitive field controls 🔴 high", async () => {
    // An ARIA combobox's listbox isn't its descendant; the region it
    // controls is withheld through `controlledRegion`, so stopping that walk
    // short is the leak.
    const corePath = "packages/extension/src/native/native-core.ts";
    const core = `export function controlledRegion(raw, rawNodes, keptIds) {\n  for (const childId of node.childIds ?? []) stack.push(childId);\n}\n`;
    const result = await grade(
      { [corePath]: core.replace("stack.push(childId)", "void childId") },
      { base: { [corePath]: core } },
    );

    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "field-value-redaction"), [
      `${corePath} → controlledRegion`,
    ]);
  });

  it("grades loosening the native verdict's fail-closed flag 🔴 high", async () => {
    const corePath = "packages/extension/src/native/native-core.ts";
    const core = `export function fieldValueWithheld(read) {\n  return !(read.classified === true && read.sensitive !== true);\n}\n`;
    const result = await grade(
      {
        [corePath]: core.replace("read.classified === true && ", ""),
      },
      { base: { [corePath]: core } },
    );

    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "field-value-redaction"), [
      `${corePath} → fieldValueWithheld`,
    ]);
  });
});

describe("field-value redaction covers selecting an option row", () => {
  it("grades naming a withheld select's option from its row 🔴 high", async () => {
    // A sensitive select's chosen option IS its value: the feedback after a
    // row's own Select must name only the field.
    const path = "packages/extension/src/sidepanel/native-feedback.ts";
    const base = `export function selectFeedback(option, nodes) {\n  const withheld = ownerWithholds(option, nodes);\n  return describeSelection(fieldName(option, nodes), option.name, withheld);\n}\n`;
    const result = await grade(
      {
        [path]: base.replace(
          "const withheld = ownerWithholds(option, nodes);",
          "const withheld = false;",
        ),
      },
      { base: { [path]: base } },
    );
    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "field-value-redaction"), [
      `${path} → selectFeedback`,
    ]);
  });
});

describe("field-value redaction covers the redactInput strict mode", () => {
  it("grades narrowing strictValueRoots or dropping the switch 🔴 high", async () => {
    // Under `redactInput` the native producer withholds all an editing root
    // holds, and `strictValueRoots` decides which roots count. Deleting a kind
    // of root puts that editor's text back in the output, and the deleted line
    // names only what it tested — the hunk header carries the gate. The CLI
    // side is the switch itself: stop passing it through and the flag is
    // accepted and does nothing.
    const strictPath = "packages/browser/src/native-tree.ts";
    const strict = `export function strictValueRoots(raw: RawNode[]): Set<string> {\n  const roots = new Set<string>();\n  for (const node of raw) {\n    if (isEditingRoot(node)) roots.add(node.nodeId);\n    if (node.value) roots.add(node.nodeId);\n  }\n  return roots;\n}\n`;
    const cliPath = "packages/cli/src/commands/tree.ts";
    const cli = `export async function runTree(page: Page, opts: Options) {\n  const tree = await readNative(page, { redactInput: opts.redactInput });\n  return render(tree);\n}\n`;
    const result = await grade(
      {
        [strictPath]: strict.replace(
          `    if (isEditingRoot(node)) roots.add(node.nodeId);\n`,
          ``,
        ),
        [cliPath]: cli.replace(
          `readNative(page, { redactInput: opts.redactInput })`,
          `readNative(page, {})`,
        ),
      },
      { base: { [strictPath]: strict, [cliPath]: cli } },
    );

    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "field-value-redaction"), [
      `${strictPath} → strictValueRoots`,
      `${cliPath} → redactInput`,
    ]);
  });
});

describe("field-value redaction covers the DOM producer's flat tree", () => {
  it("grades dropping the <textarea> guard from flatChildNodes 🔴 high", async () => {
    // A <textarea>'s child text is its markup default, and for a sensitive
    // field that default is the secret. Every DOM-producer text walk — a
    // node's text preview, an ancestor's, a name or a description by
    // reference — reads children through `flatChildNodes`, so this one line
    // keeps it out of the tree, and deleting it names nothing but the guard.
    const path = "packages/core/src/extraction/flat-tree.ts";
    const flatTree = `export function flatChildNodes(node: Node): Node[] {\n  if (isTextarea(node)) return [];\n  if (isClosedDetails(node)) return summaryOf(node);\n  return [...node.childNodes];\n}\n`;
    const result = await gradeEdit(
      path,
      flatTree,
      `  if (isTextarea(node)) return [];\n`,
      ``,
    );

    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "field-value-redaction"), [
      `${path} → isTextarea`,
    ]);
  });
});

describe("field-value redaction stays on the gates, not the files", () => {
  it("leaves an unrelated comment edit in native-tree.ts 🟡 medium", async () => {
    // Why this rule matches the gates by name rather than native-tree.ts by
    // path: most of that file builds the tree, and the gates it holds are one
    // of four places R1 is enforced — the DOM producer, the extension's native
    // path and the act path's echo mask are the others. A path rule fires on
    // this edit and misses all three.
    const result = await gradeEdit(
      NATIVE_TREE_PATH,
      NATIVE_TREE,
      `// One pass over CDP's flat list; parents arrive before their children.`,
      `// A single pass over CDP's flat list — parents always precede children.`,
    );

    assert.equal(result.tier, "medium");
    assert.deepEqual(ruleIds(result), ["published-src"]);
  });

  it("does not attribute a new declaration to the gate it was appended after", async () => {
    // A hunk header names the nearest column-0 line ABOVE the hunk, which is
    // not always a declaration the hunk is inside: a new top-level block
    // inserted after `isSensitiveField` is reported under it. Trusting the
    // header only when the hunk's first changed line is indented is what keeps
    // a neighbour of a gate from grading as the gate.
    const result = await gradeEdit(
      DOM_EXTRACTOR_PATH,
      DOM_EXTRACTOR,
      `}\n\nexport function getDescendantText`,
      `}\n\n/**\n * Tags that end a line of collapsed text.\n */\nexport const LINE_BREAKING_TAGS = ["br", "hr"];\n\nexport function getDescendantText`,
    );

    assert.equal(result.tier, "medium");
    assert.deepEqual(ruleIds(result), ["published-src"]);
  });

  it("does not attribute a docblock to the gate above it", async () => {
    // The same trap one space in: ` * …` is indented, but it is a top-level
    // JSDoc line, and the column-0 line above it is the gate that ends just
    // before — `}` and `/**` are never a hunk header. In the real file that
    // put `nativeAXView`'s docblock under `redactedName`.
    const result = await gradeEdit(
      NATIVE_TREE_PATH,
      NATIVE_TREE,
      ` * Build the tree from CDP's flat node list.`,
      ` * Build the tree from Chromium's flat AX node list.`,
    );

    assert.equal(result.tier, "medium");
    assert.deepEqual(ruleIds(result), ["published-src"]);
  });
});

describe("the code scan cannot be switched off by where it runs", () => {
  it("reads through git config that reshapes diff output", async () => {
    // The parse needs `a/` `b/` prefixes and a bare `diff --git` line. Before
    // the rubric pinned its diff format, `diff.mnemonicPrefix` (`c/` `w/`)
    // or `color.diff=always` on the author's machine left the code scan
    // empty: this same allowlist edit graded 🟡 locally and 🔴 in CI.
    const edit = [`  "placeholder",\n`, `  "placeholder",\n  "value",\n`];
    for (const config of [
      { "diff.mnemonicPrefix": "true" },
      { "diff.noprefix": "true" },
      { "color.diff": "always", "color.ui": "always" },
    ]) {
      const result = await grade(
        { [NATIVE_TREE_PATH]: NATIVE_TREE.replace(...edit) },
        { base: { [NATIVE_TREE_PATH]: NATIVE_TREE }, config },
      );
      assert.equal(result.tier, "high", JSON.stringify(config));
      assert.deepEqual(
        evidenceFor(result, "field-value-redaction"),
        [`${NATIVE_TREE_PATH} → DOM_ATTR_ALLOWLIST`],
        JSON.stringify(config),
      );
    }
  });

  it("reads through a -diff attribute that makes a gate binary", async () => {
    // "Binary files differ" has no lines to scan. With the attribute already
    // on the base, a PR widening the allowlist showed nothing to either
    // redaction rule — so the diff is forced to text.
    const edit = [`  "placeholder",\n`, `  "placeholder",\n  "value",\n`];
    const result = await grade(
      { [NATIVE_TREE_PATH]: NATIVE_TREE.replace(...edit) },
      {
        base: {
          [NATIVE_TREE_PATH]: NATIVE_TREE,
          "packages/browser/src/.gitattributes": "native-tree.ts -diff\n",
        },
      },
    );

    assert.deepEqual(evidenceFor(result, "field-value-redaction"), [
      `${NATIVE_TREE_PATH} → DOM_ATTR_ALLOWLIST`,
    ]);
  });

  it("grades a nested .gitattributes 🔴 high, like the root one", async () => {
    const result = await grade(["packages/browser/src/.gitattributes"]);

    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "verification-machinery"), [
      "packages/browser/src/.gitattributes",
    ]);
  });

  it("reads a path git has to quote, instead of refusing to grade", async () => {
    // A `"` in a path makes git C-quote the `diff --git` header, which the
    // plain `a/… b/…` parse can't read — and an unreadable section stops the
    // whole run, on purpose. So the quoted form has to parse, or one oddly
    // named file wedges every future run on the PR.
    //
    // Built with plumbing because Windows can't create the file on disk. The
    // path never reaches the working tree, so the rubric sees it deleted —
    // every base line on the `-` side, which is enough to prove the parse.
    const dir = join(root, `case-${++n}`);
    await mkdir(dir, { recursive: true });
    await git(dir, ["init", "-q", "-b", "main"]);
    // On by default on Windows, where it refuses a `"` in any index path.
    await git(dir, ["config", "core.protectNTFS", "false"]);
    const blob = join(dir, "blob");
    await writeFile(blob, NATIVE_TREE);
    const { stdout: sha } = await run("git", ["hash-object", "-w", blob], {
      cwd: dir,
      env: HERMETIC_ENV,
    });
    const odd = 'packages/browser/src/native"tree.ts';
    await git(dir, [
      "update-index",
      "--add",
      "--cacheinfo",
      `100644,${sha.trim()},${odd}`,
    ]);
    await git(dir, ["commit", "-q", "--no-verify", "-m", "chore: seed"]);
    await git(dir, ["checkout", "-q", "-b", "topic"]);

    const { stdout } = await run(
      process.execPath,
      [RUBRIC, "--repo", dir, "--base", "main", "--format", "json"],
      { env: HERMETIC_ENV },
    );

    assert.deepEqual(evidenceFor(JSON.parse(stdout), "field-value-redaction"), [
      `${odd} → DOM_ATTR_ALLOWLIST, allowlistAttributes`,
    ]);
  });

  it("reads a new file before it is committed", async () => {
    // `git diff` cannot see an untracked file, and `pnpm pr:risk` is meant to
    // be run before the commit exists.
    const result = await grade(
      { "packages/browser/src/field-gate.ts": NATIVE_TREE },
      { commit: false },
    );

    assert.deepEqual(evidenceFor(result, "field-value-redaction"), [
      "packages/browser/src/field-gate.ts → DOM_ATTR_ALLOWLIST, allowlistAttributes",
    ]);
  });

  it("does not scan the rubric's own tests, which must name every gate", async () => {
    // `excludeSelf` exists because a rule listing the names it hunts matches
    // its own source. These tests have to write those names into fixtures, so
    // without the exclusion every PR touching them carries a bullet per gate.
    const result = await grade({
      "scripts/pr-risk.test.mjs": `const gates = ["isSensitiveField", "redactUrl"];\n`,
    });

    assert.deepEqual(ruleIds(result), ["verification-machinery"]);
  });
});

describe("a boundary name counts with a prefix or a suffix", () => {
  it("catches redactUrlsIn and NATIVE_REDACTED_VALUE, which a word boundary missed", async () => {
    // `redactUrlsIn` is this repo's own bulk URL redaction, called on every
    // error message the MCP server and the CLI daemon print. The boundary
    // this replaced blocked any alphanumeric suffix and any `_` prefix, so
    // deleting that call — or blanking the extension's redaction sentinel —
    // graded no higher than any other source edit.
    const server = `export function errorText(message: string): string {\n  return redactUrlsIn(message);\n}\n`;
    const core = `export const NATIVE_REDACTED_VALUE = "[redacted]";\n`;
    const result = await grade(
      {
        "packages/mcp/src/server.ts": server.replace(
          "redactUrlsIn(message)",
          "message",
        ),
        "packages/extension/src/native/native-core.ts": core.replace(
          `"[redacted]"`,
          `""`,
        ),
      },
      {
        base: {
          "packages/mcp/src/server.ts": server,
          "packages/extension/src/native/native-core.ts": core,
        },
      },
    );

    assert.deepEqual(evidenceFor(result, "secrets-and-redaction"), [
      "packages/mcp/src/server.ts → redactUrl",
    ]);
    assert.deepEqual(evidenceFor(result, "field-value-redaction"), [
      "packages/extension/src/native/native-core.ts → REDACTED_VALUE",
    ]);
  });
});

const REACT_TEST_PATH = "packages/react/src/react.test.tsx";
const REACT_TEST = `import { describe, expect, it } from "vitest";

describe("SemanticPanel", () => {
  it("renders the tree", async () => {
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("tree")).toBeTruthy();
  });
});
`;
const FLAKE_FIX = [
  `await new Promise((r) => setTimeout(r, 50));`,
  `await waitFor(() => screen.getByRole("tree"));`,
];

describe("co-located tests grade as tests, not as published source", () => {
  it("grades a test-only diff inside a published package's src 🟢 low", async () => {
    // The shape of a real flake fix here: one `react.test.tsx`, sleeps swapped
    // for a wait. `published-src` matched it before `LOW_SHAPED` was asked,
    // so it went to a human — while the same edit to a spec under `e2e/`
    // was agent-mergeable. Neither can reach a published artifact.
    const fixture = "packages/core/src/native/__fixtures__/ax-media-form.json";
    const result = await grade(
      {
        [REACT_TEST_PATH]: REACT_TEST.replace(...FLAKE_FIX),
        [fixture]: `{"nodes":[{"role":"slider"}]}\n`,
      },
      { base: { [REACT_TEST_PATH]: REACT_TEST, [fixture]: `{"nodes":[]}\n` } },
    );

    assert.equal(result.tier, "low");
    assert.deepEqual(result.reasons, []);
    assert.deepEqual(result.unrecognised, []);
    // A NESTED `__fixtures__` too — the entry this replaced was anchored to
    // `src/__fixtures__/` and missed the real one under `core/src/native/`.
    assert.deepEqual(result.shape.sort(), ["test fixtures", "tests"]);
    // Low to review is not "skip the suite": a test change has to run.
    assert.equal(result.ci.code, true);
  });

  it("still grades the source beside it 🟡 medium, citing only the source", async () => {
    const result = await grade(
      {
        [REACT_TEST_PATH]: REACT_TEST.replace(...FLAKE_FIX),
        "packages/react/src/index.ts": `export const x = 2;\n`,
      },
      { base: { [REACT_TEST_PATH]: REACT_TEST } },
    );

    assert.equal(result.tier, "medium");
    assert.deepEqual(ruleIds(result), ["published-src"]);
    assert.deepEqual(evidenceFor(result, "published-src"), [
      "packages/react/src/index.ts",
    ]);
  });

  it("still reads a test for redaction gates — the exclusion is by path only", async () => {
    // Dropping the assertion that a password field comes out redacted is a
    // test-only diff, and it is the one that most needs a human. The redaction
    // rules read code wherever it lives, so `published-src` stepping aside
    // leaves them exactly where they were.
    const test = `it("redacts a password", () => {\n  expect(isSensitiveField(pw)).toBe(true);\n});\n`;
    const path = "packages/core/src/extraction/dom-extractor.test.ts";
    const result = await grade(
      { [path]: test.replace(/ {2}expect\(isSensitiveField.*\n/, "") },
      { base: { [path]: test } },
    );

    assert.equal(result.tier, "high");
    assert.deepEqual(evidenceFor(result, "field-value-redaction"), [
      `${path} → isSensitiveField`,
    ]);
  });
});

describe("a test switched off or deleted grades 🟡 medium", () => {
  it("catches a skip marker, in src or e2e, in every extension the tests entry accepts", async () => {
    // These pass every check by construction — the suite stays green over the
    // test that stopped running — so CI can't be the review for them.
    // `.spec.mts` because `TEST_FILE` accepts it: before the code scan read
    // `mts`, the same marker there graded 🟢 where `.ts` graded 🟡.
    const e2e = "packages/cli/e2e/tree.spec.mts";
    const spec = `test("prints a tree", async () => {\n  expect(out).toContain("tree");\n});\n`;
    const result = await grade(
      {
        [REACT_TEST_PATH]: REACT_TEST.replace(
          `  it("renders the tree"`,
          `  it.skipIf(process.platform === "win32")("renders the tree"`,
        ).replace(`describe("SemanticPanel"`, `describe.only("SemanticPanel"`),
        [e2e]: spec.replace(
          `  expect(out)`,
          `  test.fixme();\n  ctx.skip();\n  expect(out)`,
        ),
      },
      { base: { [REACT_TEST_PATH]: REACT_TEST, [e2e]: spec } },
    );

    assert.equal(result.tier, "medium");
    assert.deepEqual(ruleIds(result), ["tests-disabled"]);
    assert.deepEqual(evidenceFor(result, "tests-disabled"), [
      `${e2e} → test.fixme, ctx.skip`,
      `${REACT_TEST_PATH} → describe.only, it.skipIf`,
    ]);
  });

  it("catches the destructured skip(), and a Jest __tests__ file with no .test. in its name", async () => {
    // `({ skip }) => skip()` is Vitest's documented in-body form, and has no
    // receiver for a `ctx.skip(` pattern to see. And Jest collects anything
    // under `__tests__/` — `examples/testing-jest` runs under root
    // `pnpm test`, in the `examples/` bucket that grades 🟢 low on its own.
    const jest = "examples/testing-jest/__tests__/matchers.ts";
    const body = `it("matches", () => {\n  expect(tree).toHaveRole("tree");\n});\n`;
    const result = await grade(
      {
        [REACT_TEST_PATH]: REACT_TEST.replace(
          `async () => {\n    await`,
          `async ({ skip }) => {\n    skip();\n    await`,
        ),
        [jest]: body.replace(`it("matches"`, `it.skip("matches"`),
      },
      { base: { [REACT_TEST_PATH]: REACT_TEST, [jest]: body } },
    );

    assert.equal(result.tier, "medium");
    assert.deepEqual(evidenceFor(result, "tests-disabled"), [
      `${jest} → it.skip`,
      `${REACT_TEST_PATH} → skip`,
    ]);
  });

  it("grades a deleted test 🟡 medium, but switching one back on 🟢 low", async () => {
    const skipped = REACT_TEST.replace(`  it(`, `  it.skip(`);
    const gone = "packages/core/src/flatten.test.ts";
    const deleted = await grade(
      { [gone]: null },
      { base: { [gone]: `it("flattens", () => {});\n` } },
    );
    const reenabled = await grade(
      { [REACT_TEST_PATH]: REACT_TEST },
      { base: { [REACT_TEST_PATH]: skipped } },
    );

    assert.equal(deleted.tier, "medium");
    assert.deepEqual(evidenceFor(deleted, "tests-disabled"), [
      `${gone} → deleted`,
    ]);
    // The `-` side of a skip is a test coming back, not going away.
    assert.equal(reenabled.tier, "low");
    assert.deepEqual(reenabled.reasons, []);
  });

  it("grades an example's scripts 🔴 high, though examples/ is low", async () => {
    // `pnpm install` runs every workspace project's install lifecycle, and
    // root `build` runs any example it doesn't exclude — both inside the
    // publish job, which can mint npm's Trusted Publisher token. So a
    // `postinstall` here is agent-mergeable code with publish rights, and the
    // `verify` split around the test suite would mean nothing without this.
    const manifest = "examples/testing-jest/package.json";
    const base = `${JSON.stringify({ name: "x", private: true, scripts: { test: "jest" } })}\n`;
    const scripts = await grade(
      {
        [manifest]: base.replace(`"jest"`, `"jest","postinstall":"node x.mjs"`),
      },
      { base: { [manifest]: base } },
    );
    const deps = await grade(
      {
        [manifest]: base.replace(`"private"`, `"devDependencies":{},"private"`),
      },
      { base: { [manifest]: base } },
    );

    assert.equal(scripts.tier, "high");
    assert.deepEqual(evidenceFor(scripts, "packaging"), [
      `${manifest} → scripts`,
    ]);
    // Nothing else in a private manifest reaches anyone.
    assert.equal(deps.tier, "low");
  });

  it("catches Vitest's options object, which names no runner method", async () => {
    // `it("x", { skip: true }, fn)` switches a test off with nothing for a
    // `.skip` pattern to see. `skip:` counts with any value but `false` (the
    // platform-conditional skip is the realistic one); `only` with `true` alone,
    // because `{ only: "findings" }` is real data in the CLI's tests.
    const result = await grade(
      {
        [REACT_TEST_PATH]: REACT_TEST.replace(
          `  it("renders the tree", async`,
          `  it("renders the tree", { skip: process.platform === "win32" }, async`,
        ).replace(
          `describe("SemanticPanel", ()`,
          `describe("SemanticPanel", { only: true }, ()`,
        ),
      },
      { base: { [REACT_TEST_PATH]: REACT_TEST } },
    );
    const data = await grade(
      {
        [REACT_TEST_PATH]: REACT_TEST.replace(
          `    expect(screen`,
          `    render({ only: "findings", skip: false });\n    expect(screen`,
        ),
      },
      { base: { [REACT_TEST_PATH]: REACT_TEST } },
    );

    assert.deepEqual(evidenceFor(result, "tests-disabled"), [
      `${REACT_TEST_PATH} → { only }, { skip }`,
    ]);
    assert.equal(data.tier, "low");
  });

  it("is not tripped by a property that happens to be called only", async () => {
    // `meta.only` is a real field the snapshot tests assert on. Only a chain
    // that starts at a runner global counts for `only`.
    const result = await grade(
      {
        [REACT_TEST_PATH]: REACT_TEST.replace(
          `    expect(screen`,
          `    expect(artifact.meta.only).toBe("views");\n    expect(screen`,
        ),
      },
      { base: { [REACT_TEST_PATH]: REACT_TEST } },
    );

    assert.equal(result.tier, "low");
  });
});
