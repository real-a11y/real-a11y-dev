#!/usr/bin/env node
/**
 * Rules oracle — run W3C ACT Rules test cases through our `audit` rules, on
 * both producers.
 *
 * Every ACT rule ships Passed / Failed / Inapplicable HTML examples and names
 * the WCAG success criteria it tests. For each example we load it in Chromium,
 * run `collectFindings` over the DOM producer's tree (in-page, as the injected
 * bundle does) and over the native tree (in Node, as the CLI/MCP do), and keep
 * only the findings of the rule(s) MAPPED to that ACT rule:
 *
 *   Failed        → a mapped rule must fire   (else: false negative)
 *   Passed        → no mapped rule may fire   (else: false positive)
 *   Inapplicable  → no mapped rule may fire   (else: false positive)
 *
 * A row where the producers disagree is a producer-dependence bug in the rule
 * or a tree gap underneath it — `probe.mjs` the example to tell which.
 *
 * Usage (repo root, browser package chain built):
 *   node .claude/skills/conformance/scripts/act.mjs                 # every mapped rule
 *   node .claude/skills/conformance/scripts/act.mjs 23a2a8 97a4e1   # some
 *   node .claude/skills/conformance/scripts/act.mjs ffd0e9 --as no-unlabeled-interactive
 *
 * Options:
 *   --as <rule>    map the given ACT rule(s) to this audit rule (repeatable)
 *   --act-dir      local act-rules checkout (default $REAL_A11Y_ACT_DIR, else <cache>/act-rules)
 *   --chromium     Chromium executable (default $REAL_A11Y_CHROMIUM)
 *   --json         one JSON object per ACT rule, one per line
 *   --only-wrong   print only the examples we get wrong
 *
 * Exit status: 1 when any example is wrong on either producer.
 */

/* global document -- page.evaluate callbacks run in the page */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { CACHE, launch, loadPackages } from "./lib.mjs";

/**
 * ACT rule id → the audit rules that claim to catch what it fails. This table
 * IS the claim under test: a row here says "our rule enforces this", and the
 * run checks it. An ACT rule with `[]` is a coverage gap we know about — it
 * runs nothing, and prints as uncovered so the gap stays visible.
 *
 * Keep it honest: add a row when a rule starts covering a requirement, never to
 * make a run look greener.
 */
const MAPPED = {
  "23a2a8": ["image-alt"], // Image has non-empty accessible name — WCAG 1.1.1
  "97a4e1": ["no-unlabeled-interactive"], // Button has non-empty accessible name — 4.1.2
  c487ae: ["no-unlabeled-interactive"], // Link has non-empty accessible name — 2.4.4, 4.1.2
  e086e5: ["no-unlabeled-interactive"], // Form field has non-empty accessible name — 4.1.2
  m6b1q3: ["no-unlabeled-interactive"], // Menuitem has non-empty accessible name — 4.1.2
  ffd0e9: [], // Heading has non-empty accessible name — 1.3.1, 2.4.6 (uncovered)
  cae760: [], // Iframe element has non-empty accessible name — 4.1.2 (uncovered)
};

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    as: { type: "string", multiple: true },
    "act-dir": {
      type: "string",
      default: process.env.REAL_A11Y_ACT_DIR ?? join(CACHE, "act-rules"),
    },
    chromium: { type: "string", default: process.env.REAL_A11Y_CHROMIUM },
    json: { type: "boolean", default: false },
    "only-wrong": { type: "boolean", default: false },
  },
});

const rulesDir = join(opts["act-dir"], "_rules");
if (!existsSync(rulesDir)) {
  console.error(
    `No ACT rules at ${rulesDir} — sparse-clone them first (SKILL.md §2).`,
  );
  process.exit(2);
}

const {
  browser: { nativeTree, pageBundleSource },
  audit: { collectFindings },
} = await loadPackages();

const ids = positionals.length ? positionals : Object.keys(MAPPED);
const files = readdirSync(rulesDir);

/** Parse one ACT rule file: id, name, requirements, examples. */
function parseRule(id) {
  const file = files.find((f) => f.endsWith(`-${id}.md`));
  if (!file) throw new Error(`no ACT rule file for ${id} in ${rulesDir}`);
  const text = readFileSync(join(rulesDir, file), "utf8");
  const front = text.split(/^---$/m)[1] ?? "";
  const name = front.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? file;
  const requirements = [
    ...front.matchAll(/^\s{2}([a-z0-9-]+:[^\s:#]+(?::[^\s:#]+)?):/gm),
  ].map((m) => m[1]);
  const examples = [];
  const re =
    /^####\s+(Passed|Failed|Inapplicable) Example (\d+)[\s\S]*?```(\w+)?\n([\s\S]*?)```/gm;
  for (const m of text.matchAll(re)) {
    examples.push({
      outcome: m[1].toLowerCase(),
      n: Number(m[2]),
      lang: m[3] ?? "",
      html: m[4],
    });
  }
  return { id, file, name, requirements, examples };
}

function documentFor(example) {
  return /<html[\s>]/i.test(example.html)
    ? example.html
    : `<!DOCTYPE html><html lang="en"><head><title>ACT</title></head><body>${example.html}</body></html>`;
}

async function runExample(browser, example, rules) {
  const page = await browser.newPage();
  // Examples reference /test-assets/…; keep runs offline and deterministic.
  await page.route("**/*", (route) => route.abort());
  try {
    await page.setContent(documentFor(example), { waitUntil: "load" });
    await page.addScriptTag({ content: pageBundleSource() });
    const dom = await page.evaluate((rules) => {
      const ra = globalThis.__realA11y__;
      return ra
        .collectFindings(ra.extractA11yTree(document.body), rules)
        .map((f) => f.rule);
    }, rules);
    const native = collectFindings(await nativeTree(page), rules).map(
      (f) => f.rule,
    );
    return { dom: dom.length > 0, native: native.length > 0 };
  } finally {
    await page.close();
  }
}

const browser = await launch(opts.chromium);
let wrongAnywhere = false;
try {
  for (const id of ids) {
    const rules = opts.as?.length ? opts.as : (MAPPED[id] ?? []);
    let rule;
    try {
      rule = parseRule(id);
    } catch (err) {
      console.log(`ERR   ${id}  ${err.message}`);
      wrongAnywhere = true;
      continue;
    }
    if (!rules.length) {
      if (opts.json)
        console.log(
          JSON.stringify({
            id,
            name: rule.name,
            requirements: rule.requirements,
            covered: false,
          }),
        );
      else
        console.log(
          `\n== ${id} ${rule.name}  [${rule.requirements.join(", ")}]\n   UNCOVERED — no audit rule claims this requirement`,
        );
      continue;
    }

    const results = [];
    for (const ex of rule.examples) {
      if (ex.lang && !/^(html|xhtml)$/i.test(ex.lang)) {
        results.push({ ...ex, skipped: `\`\`\`${ex.lang} example` });
        continue;
      }
      const got = await runExample(browser, ex, rules);
      const shouldFire = ex.outcome === "failed";
      results.push({
        ...ex,
        dom: got.dom,
        native: got.native,
        domOk: got.dom === shouldFire,
        nativeOk: got.native === shouldFire,
      });
    }

    const ran = results.filter((r) => !r.skipped);
    const wrong = ran.filter((r) => !r.domOk || !r.nativeOk);
    wrongAnywhere ||= wrong.length > 0;
    const tally = (k) => ran.filter((r) => r[k]).length;

    if (opts.json) {
      console.log(
        JSON.stringify({
          id,
          name: rule.name,
          requirements: rule.requirements,
          rules,
          covered: true,
          results: results.map(({ html: _html, ...r }) => r),
        }),
      );
      continue;
    }
    console.log(
      `\n== ${id} ${rule.name}  [${rule.requirements.join(", ")}]  → ${rules.join(", ")}`,
    );
    console.log(
      `   dom ${tally("domOk")}/${ran.length} · native ${tally("nativeOk")}/${ran.length}${results.length > ran.length ? ` · skipped ${results.length - ran.length}` : ""}`,
    );
    for (const r of results) {
      if (r.skipped) {
        if (!opts["only-wrong"])
          console.log(`   ·  ${r.outcome} ${r.n}  skipped (${r.skipped})`);
        continue;
      }
      const ok = r.domOk && r.nativeOk;
      if (ok && opts["only-wrong"]) continue;
      const verdict = (fired, good) =>
        good
          ? fired
            ? "fires ✓"
            : "quiet ✓"
          : fired
            ? "FIRES ✗ (false positive)"
            : "QUIET ✗ (false negative)";
      const split = r.domOk !== r.nativeOk ? "   ← producers disagree" : "";
      console.log(
        `   ${ok ? "✓" : "✗"}  ${r.outcome.padEnd(12)} ${String(r.n).padStart(2)}  dom ${verdict(r.dom, r.domOk)}  native ${verdict(r.native, r.nativeOk)}${split}`,
      );
      if (!ok)
        console.log(
          `        ${r.html.trim().replace(/\s+/g, " ").slice(0, 140)}`,
        );
    }
  }
} finally {
  await browser.close();
}
process.exit(wrongAnywhere ? 1 : 0);
