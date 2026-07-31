// Read the release test scenarios out of the repo.
//
// The suites used to live only in Notion, which made them unreviewable: a PR
// could change the behaviour a scenario asserts and nothing connected the two.
// In the repo they diff alongside the code that broke them, and `plan` can name
// the rows a change affects instead of saying "check them by hand".
//
// FORMAT CONSTRAINT, and it is a real one. `plan` runs in a CI job with no
// `node_modules` — deliberately, so posting an advisory comment needs no install
// — and `plan` is the main consumer of these files. So the frontmatter has to be
// readable with no parser dependency, which rules out YAML proper even though
// `yaml` is sitting in the lockfile.
//
// The answer is a deliberately tiny subset: `key: value` and `key:` followed by
// `  - item` lines. Nothing else. Anything a real YAML parser would accept and
// this wouldn't — nesting, anchors, block scalars, flow sequences — is a hard
// error naming the file and line, so the restriction can never silently
// mis-read a file into a plausible-looking wrong value. A quiet mis-parse is
// the one failure this cannot afford, since everything downstream trusts it.
//
// The one place that rule is asymmetric, and it is a decision rather than an
// oversight: a `#` at the START of a line is a comment, and a `#` anywhere else
// is literal text. It has to be literal, because real rows carry `(#258)` in
// `validFrom` and `expected` — the PR that migrated the producers — and a
// trailing-comment rule would truncate them. So there is NO trailing-comment
// syntax; `expected: P0 # flagship` yields the string `P0 # flagship`, exactly as
// written. For the enum-valued keys that is caught immediately by `validate`;
// for the free-text ones the value is read verbatim, which is the promise.

import { readdir, readFile } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";

export const SUITES = {
  regression: { prefix: "R", when: "pre-publish" },
  dogfood: { prefix: "D", when: "post-publish" },
};

/** Shared by both suites; each adds its own, per the plan's suite profiles. */
const SHARED_AREAS = [
  "CLI",
  "MCP",
  "Testing",
  "Extension",
  "React/Inspector",
  "Storybook",
  "Docs/Site",
];
const AREAS = {
  regression: [...SHARED_AREAS, "Packaging", "Release"],
  dogfood: [...SHARED_AREAS, "Install health"],
};

const TYPES = ["Automated", "Manual"];
const PRIORITIES = ["P0", "P1", "P2"];
const STATUSES = ["Active", "Deprecated"];

/** Frontmatter keys that hold a list rather than a string. */
const LIST_KEYS = new Set(["covers"]);

/**
 * Keys that accept either form — `twin: D1` or `twin:` + `  - D1` lines.
 *
 * Twins are not one-to-one, which is the whole reason this exists. R1 (tarballs
 * install clean), R2 (manifests are publish-correct) and R22 (release integrity)
 * all pair with the single post-publish row D1 (registry health): three
 * pre-publish angles on one question, "did what we shipped actually arrive?".
 * Forcing 1:1 would mean dropping two of those links, and a link that isn't
 * recorded is one `plan` can't report.
 *
 * The scalar form stays legal because most rows really do have exactly one twin,
 * and making every one of them a single-item list would be noise.
 */
const FLEX_LIST_KEYS = new Set(["twin"]);

/** Required of every scenario, in both suites. */
const REQUIRED = [
  "id",
  "suite",
  "scenario",
  "area",
  "type",
  "priority",
  "status",
  "validFrom",
  "expected",
];

/**
 * Parse the restricted frontmatter subset described in the header.
 *
 * @returns {{data: Record<string, string|string[]>, body: string, problems: string[]}}
 */
export function parseFrontmatter(text, where) {
  const problems = [];
  const lines = text.split("\n");

  if (lines[0]?.trim() !== "---") {
    return {
      data: {},
      body: text,
      problems: [`${where}:1 — must open with a \`---\` frontmatter fence`],
    };
  }
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    return {
      data: {},
      body: "",
      problems: [`${where} — frontmatter is never closed with \`---\``],
    };
  }

  const data = {};
  let listKey = null;

  for (let i = 1; i < end; i++) {
    const raw = lines[i];
    const at = `${where}:${i + 1}`;
    // A WHOLE-LINE `#` is a comment. A `#` anywhere else is literal text, and
    // deliberately so: five rows carry `(#258)` in `validFrom` or `expected`,
    // referring to the producer-migration PR, so treating a trailing `#` as a
    // comment would silently truncate real content. There is no trailing-comment
    // syntax in this format — see the header.
    if (!raw.trim() || raw.trim().startsWith("#")) continue;

    // A list item continues the key above it.
    const item = /^ {2}- (.*)$/.exec(raw);
    if (item) {
      if (!listKey) {
        problems.push(`${at} — list item with no key above it: ${raw.trim()}`);
        continue;
      }
      data[listKey].push(unquote(item[1].trim(), at, problems));
      continue;
    }

    const pair = /^([A-Za-z][A-Za-z0-9_]*):(.*)$/.exec(raw);
    if (!pair) {
      problems.push(
        `${at} — not \`key: value\` or \`  - item\`. This reader supports only ` +
          `that subset (see scripts/surface/scenarios/load.mjs): ${raw.trim()}`,
      );
      listKey = null;
      continue;
    }

    const [, key, rest] = pair;
    const value = rest.trim();

    // A repeated key is an error, not last-wins.
    //
    // This is the inverse of the rule in the header and needs stating separately
    // because of it: the header covers things real YAML accepts and this reader
    // won't. Duplicate mapping keys are the other way round — real YAML REJECTS
    // them, and this reader was quietly taking the last one. A second `covers:`
    // block silently discarded the first, so a row could stop covering
    // capabilities it visibly lists, and the coverage gate would report a gap
    // against a file whose author had written it correctly.
    //
    // Guarded here rather than per-branch so it holds for scalars, lists and the
    // flex keys alike — three places that would otherwise drift apart.
    if (Object.hasOwn(data, key)) {
      problems.push(
        `${at} — \`${key}\` is set more than once. The reader would keep only the ` +
          `last, silently dropping what the earlier one listed; real YAML rejects ` +
          `duplicate keys too. Merge them into a single entry.`,
      );
      listKey = null;
      continue;
    }

    if (FLEX_LIST_KEYS.has(key)) {
      // `twin: D1` is shorthand for a one-item list; `twin:` opens a list.
      data[key] = value ? [unquote(value, at, problems)] : [];
      listKey = value ? null : key;
      continue;
    }
    if (LIST_KEYS.has(key)) {
      if (value) {
        problems.push(
          `${at} — \`${key}\` takes \`  - item\` lines beneath it, not an inline value`,
        );
      }
      data[key] = [];
      listKey = key;
      continue;
    }
    if (!value) {
      // An empty string is meaningful (`validUntil:` = still valid).
      data[key] = "";
      listKey = null;
      continue;
    }
    data[key] = unquote(value, at, problems);
    listKey = null;
  }

  return {
    data,
    body: lines
      .slice(end + 1)
      .join("\n")
      .trim(),
    problems,
  };
}

/**
 * Strip one layer of matching quotes; values are plain strings otherwise.
 *
 * A backslash inside a quoted value is REJECTED rather than passed through. This
 * reader has no unescaping step, so `\"` would survive into the value as two
 * literal characters — a silent mis-read into a plausible-looking wrong string,
 * which is the one outcome the format promises can't happen. It is also the exact
 * mistake a YAML-trained author makes, and R23 shipped with it.
 *
 * Inner quotes need no escaping anyway: the pattern is anchored to the first and
 * last character, so `expected: "it reads as 'x' here"` round-trips fine, and so
 * does a double quote inside a single-quoted value.
 */
function unquote(value, at, problems) {
  const m = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
  if (!m) return value;
  if (problems && m[1].includes("\\")) {
    problems.push(
      `${at} — backslash inside a quoted value. This reader is not YAML and does ` +
        `no unescaping, so the backslash would end up in the value verbatim. ` +
        `Inner quotes don't need escaping — swap the inner pair for the other ` +
        `quote character, or drop the outer quotes.`,
    );
  }
  return m[1];
}

/** Validate one scenario's frontmatter against the shared schema. */
function validate(scenario, file) {
  const problems = [];
  const fail = (message) => problems.push(`${file} — ${message}`);

  for (const key of REQUIRED) {
    if (scenario[key] === undefined || scenario[key] === "") {
      fail(`missing \`${key}\``);
    }
  }
  if (problems.length) return problems; // the rest would cascade

  if (!SUITES[scenario.suite]) {
    fail(`\`suite\` must be one of: ${Object.keys(SUITES).join(", ")}`);
    return problems;
  }
  const { prefix } = SUITES[scenario.suite];
  if (!new RegExp(`^${prefix}\\d+$`).test(scenario.id)) {
    fail(`\`id\` must look like ${prefix}12 for the ${scenario.suite} suite`);
  }
  if (!AREAS[scenario.suite].includes(scenario.area)) {
    fail(
      `\`area\` "${scenario.area}" isn't valid for ${scenario.suite} — one of: ${AREAS[scenario.suite].join(", ")}`,
    );
  }
  if (!TYPES.includes(scenario.type)) fail(`\`type\` must be Automated|Manual`);
  if (!PRIORITIES.includes(scenario.priority))
    fail(`\`priority\` must be P0|P1|P2`);
  if (!STATUSES.includes(scenario.status)) {
    fail(`\`status\` must be Active|Deprecated`);
  }

  // §4b: a deprecated row keeps its reason and gains an end of its range.
  if (scenario.status === "Deprecated" && !scenario.validUntil) {
    fail(
      "is Deprecated but has no `validUntil` — a deprecated scenario records the " +
        "last version its behaviour was true of, or a future reader can't tell " +
        "whether a run against an older release should have passed",
    );
  }
  if (scenario.status === "Active" && scenario.validUntil) {
    fail(
      "is Active but has a `validUntil` — a version range that has ended means " +
        "the row should be Deprecated",
    );
  }

  return problems;
}

/**
 * Every scenario in the repo, plus everything wrong with them.
 *
 * Returns problems rather than throwing so one malformed file reports alongside
 * the others instead of hiding them.
 */
export async function loadScenarios(repoRoot, dir = "scenarios") {
  const scenarios = [];
  const problems = [];
  const root = join(repoRoot, dir);

  for (const suite of Object.keys(SUITES)) {
    let files;
    try {
      files = (await readdir(join(root, suite))).filter((f) =>
        f.endsWith(".md"),
      );
    } catch {
      continue; // a suite with no directory yet is not an error
    }

    for (const name of files.sort()) {
      const abs = join(root, suite, name);
      const file = relative(repoRoot, abs).split(sep).join(posix.sep);
      const text = await readFile(abs, "utf8");
      const parsed = parseFrontmatter(text, file);
      problems.push(...parsed.problems);
      if (parsed.problems.length) continue;

      // Check the DECLARED suite before merging, not after. The merge below sets
      // `suite` from the directory, and the directory always wins — so once it
      // has run, `suite` can never be undefined and the `REQUIRED` entry for it
      // (and validate's `SUITES[...]` guard) are both unreachable. A file that
      // omitted `suite:` entirely was silently accepted, while README documents
      // it as required.
      if (!parsed.data.suite) {
        problems.push(
          `${file} — missing \`suite\`. It must be declared even though the ` +
            `directory implies it: the two are cross-checked, and a row that ` +
            `states nothing can't disagree with anything.`,
        );
        continue;
      }
      // A frontmatter value that disagrees with the directory would make the file
      // findable under the wrong prefix.
      if (parsed.data.suite !== suite) {
        problems.push(
          `${file} — \`suite: ${parsed.data.suite}\` but the file is under ${suite}/`,
        );
        continue;
      }

      const scenario = { ...parsed.data, body: parsed.body, file, suite };
      // The filename carries the id so a PR that cites R12 finds R12.
      if (scenario.id && !name.startsWith(`${scenario.id}-`)) {
        problems.push(
          `${file} — filename must start with \`${scenario.id}-\` so the id in a PR body locates the file`,
        );
      }
      const invalid = validate(scenario, file);
      problems.push(...invalid);

      // A row that failed validation is REPORTED but not RETURNED.
      //
      // `plan` ignores `problems` on purpose — a malformed file must not break a
      // report whose whole value is being available on every PR. But "tolerate"
      // has to mean skip, not consume: a row with no `id` renders as a blank
      // entry in the paste-ready block (`Updated: D2, `), and one with
      // `status: active` in the wrong case is read as non-Active, so `plan`
      // labels a live row `(Deprecated)` and can fire the coverage-gap warning
      // for something that is fine.
      //
      // `check` is unaffected either way: it refuses to run `checkScenarios` at
      // all while any load problem exists, so it still reports every one of them.
      if (invalid.length) continue;
      scenarios.push(scenario);
    }
  }

  return { scenarios, problems };
}

/** Numeric order within a suite — R2 before R10, which a string sort reverses. */
export function byId(a, b) {
  const num = (s) => Number(s.id.slice(1));
  return a.suite.localeCompare(b.suite) || num(a) - num(b);
}
