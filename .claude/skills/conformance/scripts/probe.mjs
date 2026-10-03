#!/usr/bin/env node
/**
 * Conformance probe — one page, up to four answers per element:
 *
 *   spec    what the page says the element should be: WPT's `data-expectedrole`,
 *           `data-expectedlabel`, `data-expectedproperties`, or `.ex-generic`
 *   raw     Chromium's own AX node for the element, straight off CDP
 *   native  the native producer (that raw node, normalized by core/src/native)
 *   dom     the DOM producer (core/src/extraction, via the injected page bundle)
 *
 * Elements are paired across producers by `id` — the one attribute both keep
 * (`KEY_ATTRIBUTES` in core, `DOM_ATTR_ALLOWLIST` in browser). Every element
 * without one is stamped `rap-<n>` after load; an id nothing references changes
 * no role or name.
 *
 * Usage (from the repo root, after building the browser package chain):
 *   node .claude/skills/conformance/scripts/probe.mjs <input>... [options]
 *
 * An <input> is an .html file, a directory (every .html under it that carries a
 * WPT expectation), `wpt:<path>` (resolved against --wpt-dir, else fetched from
 * raw.githubusercontent.com), or an http(s) URL. `--html '<markup>'` probes a
 * snippet.
 *
 * Options:
 *   --all        print every paired element, not only the ones that disagree
 *   --tabs       compare the DOM producer's tab sequence with real Tab presses
 *   --summary    one line per page (for sweeps)
 *   --json       machine-readable: one JSON object per page, one per line
 *   --wpt-dir    local WPT checkout (default $REAL_A11Y_WPT_DIR, else
 *                <cache>/wpt — see lib.mjs)
 *   --chromium   Chromium executable (default $REAL_A11Y_CHROMIUM, else the
 *                build the repo's Playwright pins). The header prints the
 *                milestone: a finding only counts on the one CI runs.
 *
 * Exit status: 1 when any page has a dom-gap or a tab-order difference, else 0.
 * `chromium≠spec` alone does not fail — mirroring Chromium is the policy.
 */

/* global document, window -- page.evaluate callbacks run in the page */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { CACHE, launch, loadPackages } from "./lib.mjs";

const WPT_RAW =
  "https://raw.githubusercontent.com/web-platform-tests/wpt/master/";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    html: { type: "string" },
    all: { type: "boolean", default: false },
    tabs: { type: "boolean", default: false },
    summary: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    chromium: { type: "string", default: process.env.REAL_A11Y_CHROMIUM },
    "wpt-dir": {
      type: "string",
      default: process.env.REAL_A11Y_WPT_DIR ?? join(CACHE, "wpt"),
    },
  },
});

if (!opts.html && positionals.length === 0) {
  console.error(
    "usage: probe.mjs <file|dir|wpt:path|url>... [--all] [--tabs] [--summary] [--json]\n" +
      "       probe.mjs --html '<button>Save</button>'",
  );
  process.exit(2);
}

const {
  browser: { nativeTree, pageBundleSource },
} = await loadPackages();

// ---------------------------------------------------------------------------
// Inputs

/** @returns {{label: string, tentative: boolean, load: (page) => Promise<void>}[]} */
function expandInputs() {
  const out = [];
  if (opts.html) {
    out.push({
      label: "--html",
      tentative: false,
      load: (page) => page.setContent(opts.html, { waitUntil: "load" }),
    });
  }
  for (const input of positionals) {
    if (input.startsWith("wpt:")) {
      const rel = input.slice(4).replace(/^\/+/, "");
      const local = join(opts["wpt-dir"], rel);
      if (existsSync(local)) out.push(...fromPath(local, `wpt:${rel}`));
      else if (rel.endsWith(".html")) out.push(fromRaw(WPT_RAW + rel, input));
      else {
        console.error(
          `${input}: no local WPT checkout at ${opts["wpt-dir"]} — a directory needs one (see SKILL.md §2).`,
        );
        process.exit(2);
      }
    } else if (/^https?:\/\//.test(input)) {
      out.push(
        new URL(input).host === "raw.githubusercontent.com"
          ? fromRaw(input, input)
          : {
              label: input,
              tentative: false,
              load: (page) => page.goto(input, { waitUntil: "load" }),
            },
      );
    } else {
      out.push(...fromPath(resolve(input), input));
    }
  }
  return out;
}

function fromPath(path, label) {
  if (!existsSync(path)) {
    console.error(`${label}: not found`);
    process.exit(2);
  }
  if (statSync(path).isDirectory()) {
    return walk(path)
      .filter((f) => /data-expected|ex-generic/.test(readFileSync(f, "utf8")))
      .map((f) => fileInput(f, join(label, relative(path, f))));
  }
  return [fileInput(path, label)];
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? walk(join(dir, e.name))
        : e.name.endsWith(".html")
          ? [join(dir, e.name)]
          : [],
    )
    .sort();
}

function fileInput(path, label) {
  return {
    label,
    tentative: path.includes(".tentative."),
    load: (page) => page.goto(pathToFileURL(path).href, { waitUntil: "load" }),
  };
}

function fromRaw(url, label) {
  return {
    label,
    tentative: url.includes(".tentative."),
    load: async (page) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      await page.setContent(await res.text(), { waitUntil: "load" });
    },
  };
}

// ---------------------------------------------------------------------------
// One page

async function probePage(page, input) {
  await input.load(page);

  // Stamp ids (piercing open shadow roots) and read the expectations. Only
  // these ids are compared: a UA shadow root (a date input's picker, media
  // controls) is native-only by design, and carries Chromium's own ids.
  const { expectations, owned } = await page.evaluate(() => {
    let n = 0;
    const out = [];
    const owned = [];
    const visit = (root) => {
      for (const el of root.querySelectorAll("*")) {
        if (!el.id) el.id = `rap-${n++}`;
        owned.push(el.id);
        const role = el.getAttribute("data-expectedrole");
        const label = el.getAttribute("data-expectedlabel");
        const props = el.getAttribute("data-expectedproperties");
        const generic = el.classList.contains("ex-generic");
        if (role !== null || label !== null || props !== null || generic) {
          let parsed = null;
          try {
            parsed = props ? JSON.parse(props) : null;
          } catch {
            /* malformed expectation: leave it out */
          }
          out.push({
            key: el.id,
            role: generic ? "generic" : (role ?? parsed?.role ?? null),
            label: label ?? parsed?.label ?? null,
            properties: parsed,
            test:
              el.getAttribute("data-testname") ??
              el.outerHTML.replace(/\s+/g, " ").slice(0, 90),
          });
        }
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(document);
    return { expectations: out, owned };
  });

  // DOM producer, through the same bundle every surface injects.
  await page.addScriptTag({ content: pageBundleSource() });
  const dom = await page.evaluate(() => {
    const ra = globalThis.__realA11y__;
    const tree = ra.extractA11yTree(document.body);
    return {
      nodes: [...tree.nodes.values()].map((n) => ({
        key: n.dom?.attributes?.id ?? null,
        role: n.a11y.role,
        name: n.a11y.name,
        description: n.a11y.description,
        value: n.a11y.value ?? "",
        states: n.a11y.states,
      })),
      tabs: ra.getTabSequence(tree).map((n) => n.dom?.attributes?.id ?? null),
    };
  });

  // Native producer.
  const nat = await nativeTree(page);
  const nativeNodes = [...nat.nodes.values()].map((n) => ({
    key: n.dom?.attributes?.id ?? null,
    role: n.a11y.role,
    name: n.a11y.name,
    description: n.a11y.description,
    value: n.a11y.value ?? "",
    states: n.a11y.states,
  }));

  // Raw Chromium, un-normalized: id → backendNodeId → AX node.
  const raw = await rawAX(page);

  const tabs = opts.tabs ? await realTabOrder(page, dom.tabs.length) : null;

  const mine = new Set(owned);
  const keep = (nodes) => nodes.filter((n) => n.key && mine.has(n.key));
  return compare(
    input,
    nat.source?.chrome,
    expectations,
    { ...dom, nodes: keep(dom.nodes) },
    keep(nativeNodes),
    raw,
    tabs,
  );
}

async function rawAX(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send("DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    const backendById = new Map();
    const visit = (node) => {
      const attrs = node.attributes ?? [];
      for (let i = 0; i + 1 < attrs.length; i += 2) {
        if (attrs[i] === "id")
          backendById.set(attrs[i + 1], node.backendNodeId);
      }
      for (const c of node.children ?? []) visit(c);
      for (const s of node.shadowRoots ?? []) visit(s);
    };
    visit(root);
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    const byBackend = new Map();
    for (const n of nodes) {
      if (
        typeof n.backendDOMNodeId === "number" &&
        !byBackend.has(n.backendDOMNodeId)
      ) {
        byBackend.set(n.backendDOMNodeId, n);
      }
    }
    const out = new Map();
    for (const [id, backend] of backendById) {
      const n = byBackend.get(backend);
      if (!n) continue;
      out.set(id, {
        role: n.ignored ? "(ignored)" : String(n.role?.value ?? ""),
        name: collapse(String(n.name?.value ?? "")),
      });
    }
    return out;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** Press Tab from the top of the document and record which element takes focus. */
async function realTabOrder(page, expected) {
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.getSelection()?.removeAllRanges();
  });
  const seen = [];
  const limit = Math.min(500, expected * 2 + 10);
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(() => {
      let a = document.activeElement;
      while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
      return !a || a === document.body || a === document.documentElement
        ? null
        : a.id || "(no id)";
    });
    if (id === null || id === seen[0]) break;
    seen.push(id);
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Comparison

const collapse = (s) => s.replace(/\s+/g, " ").trim();
const ABSENT = "(absent)";
const NO_ROLE = new Set([
  "generic",
  "none",
  "presentation",
  "",
  ABSENT,
  "(ignored)",
]);
const canonRole = (r) => (r === "image" ? "img" : r);
const roleMeets = (actual, expected) =>
  NO_ROLE.has(expected)
    ? NO_ROLE.has(actual)
    : canonRole(actual) === canonRole(expected);

function byKey(nodes) {
  const m = new Map();
  for (const n of nodes) if (n.key && !m.has(n.key)) m.set(n.key, n);
  return m;
}

/**
 * The states both producers model: core's `ARIA_STATE_ATTRIBUTES` (plus the
 * native-HTML ones it derives) ∩ browser's `STATE_PROPS`. Outside it a
 * difference is vocabulary, not a gap — `hidden`/`current` are DOM-only,
 * `focusable`/`editable`/`invalid`/`modal`/… native-only. Re-derive it when
 * either list changes.
 */
const SHARED_STATES = [
  "expanded",
  "checked",
  "disabled",
  "pressed",
  "selected",
  "required",
  "readonly",
  "busy",
];
/** Flags where `false` and absent announce the same thing. The others don't:
 *  "not checked", "collapsed", "not pressed" are spoken; silence is not. */
const FALSE_IS_ABSENT = new Set(["disabled", "required", "readonly", "busy"]);

function stateDiff(a = {}, b = {}) {
  const out = [];
  const norm = (k, v) =>
    v === undefined || (FALSE_IS_ABSENT.has(k) && String(v) === "false")
      ? "—"
      : String(v);
  for (const k of SHARED_STATES) {
    if (norm(k, a[k]) !== norm(k, b[k]))
      out.push(`${k}: dom=${a[k] ?? "—"} native=${b[k] ?? "—"}`);
  }
  return out;
}

function compare(input, chrome, expectations, dom, nativeNodes, raw, tabs) {
  const D = byKey(dom.nodes);
  const N = byKey(nativeNodes);
  const S = new Map(expectations.map((e) => [e.key, e]));

  const keys =
    S.size && !opts.all
      ? [...S.keys()]
      : [...new Set([...D.keys(), ...N.keys(), ...S.keys()])];

  const rows = [];
  for (const key of keys) {
    const d = D.get(key);
    const n = N.get(key);
    const r = raw.get(key);
    const s = S.get(key);
    if (!d && !n && !s) continue;

    const issues = [];
    const field = (label, dv, nv, rv, sv, meets) => {
      const disagree = dv !== nv;
      // The tree folds a node's visible text into `name` when Chromium leaves
      // it unnamed (prose roles, text-only leaves — `promoteNameFromDroppedDescendants`).
      // That is display, not an accessible-name claim: when raw Chromium and
      // the spec both say "unnamed", the producers' folded text is no miss.
      const folded =
        label === "name" && sv === "" && rv === "" && dv === nv && dv !== "";
      const specMiss =
        sv != null && !folded && !(meets(dv, sv) && meets(nv, sv));
      if (!disagree && !specMiss && !opts.all) return;
      issues.push({
        field: label,
        dom: dv,
        native: nv,
        raw: rv,
        spec: sv,
        disagree,
        specMiss,
      });
    };

    const dRole = d?.role ?? ABSENT;
    const nRole = n?.role ?? ABSENT;
    // A generic both producers drop is not a disagreement.
    const sameAbsence = NO_ROLE.has(dRole) && NO_ROLE.has(nRole);
    field(
      "role",
      sameAbsence ? nRole : dRole,
      nRole,
      r?.role,
      s?.role ?? null,
      roleMeets,
    );
    // A generic native dropped for being unnamed has no name to compare; the
    // DOM producer's content name on it is never serialized by default.
    if (!(sameAbsence && !n)) {
      field(
        "name",
        collapse(d?.name ?? ""),
        collapse(n?.name ?? ""),
        r?.name,
        s?.label ?? null,
        (a, b) => a === collapse(b),
      );
    }
    if (d && n) {
      field(
        "description",
        collapse(d.description ?? ""),
        collapse(n.description ?? ""),
        undefined,
        null,
        () => true,
      );
      field(
        "value",
        collapse(d.value ?? ""),
        collapse(n.value ?? ""),
        undefined,
        null,
        () => true,
      );
      const states = stateDiff(d.states, n.states);
      if (states.length)
        issues.push({
          field: "states",
          detail: states,
          disagree: true,
          specMiss: false,
        });
    }

    const real = issues.filter((i) => i.disagree || i.specMiss);
    if (!real.length && !opts.all) continue;

    let verdict = "ok";
    if (real.some((i) => i.disagree)) verdict = "dom-gap";
    else if (real.some((i) => i.specMiss)) verdict = "chromium≠spec";

    // Hints for triage — which side of a two-way signal to suspect first.
    const hints = [];
    for (const i of real) {
      if (
        i.field === "name" &&
        i.disagree &&
        i.raw != null &&
        i.raw === i.dom
      ) {
        hints.push(
          "raw Chromium name equals the DOM producer's — suspect the native normalizer first",
        );
      }
      if (i.specMiss && i.spec != null) {
        const rawMeets =
          i.raw == null
            ? null
            : i.field === "role"
              ? roleMeets(i.raw, i.spec)
              : i.raw === collapse(i.spec);
        if (rawMeets === true && !i.disagree)
          hints.push(
            `raw Chromium meets the spec on ${i.field} — both producers lose it`,
          );
        if (rawMeets === false && !i.disagree)
          hints.push(
            `Chromium itself misses the spec on ${i.field} — mirrored by policy; ledger it`,
          );
      }
    }

    rows.push({
      key,
      test: s?.test ?? null,
      verdict,
      issues: opts.all ? issues : real,
      hints,
    });
  }

  let tabDiff = null;
  if (tabs) {
    const domTabs = dom.tabs;
    const first = domTabs.findIndex((id, i) => id !== tabs[i]);
    const differs = domTabs.length !== tabs.length || first !== -1;
    tabDiff = {
      dom: domTabs,
      chromium: tabs,
      differs,
      firstDivergence: differs
        ? first === -1
          ? Math.min(domTabs.length, tabs.length)
          : first
        : null,
    };
  }

  const count = (v) => rows.filter((r) => r.verdict === v).length;
  return {
    page: input.label,
    tentative: input.tentative,
    chrome: chrome ?? null,
    expectations: expectations.length,
    domGap: count("dom-gap"),
    chromiumVsSpec: count("chromium≠spec"),
    rows,
    tabs: tabDiff,
  };
}

// ---------------------------------------------------------------------------
// Output

function printPage(res) {
  const tag = res.tentative ? " [tentative]" : "";
  const tabs = res.tabs ? ` · tabs ${res.tabs.differs ? "DIFF" : "ok"}` : "";
  const head = `${res.domGap || res.tabs?.differs ? "DIFF" : "ok  "}  ${res.page}${tag}  expectations=${res.expectations} dom-gap=${res.domGap} chromium≠spec=${res.chromiumVsSpec}${tabs}`;
  if (opts.summary) {
    console.log(head);
    return;
  }
  console.log(`\n== ${res.page}${tag}  (Chromium ${res.chrome ?? "?"})`);
  console.log(
    `   dom-gap ${res.domGap} · chromium≠spec ${res.chromiumVsSpec}${tabs}`,
  );
  for (const row of res.rows) {
    const mark =
      row.verdict === "ok" ? "  " : row.verdict === "dom-gap" ? "✗ " : "△ ";
    console.log(
      `\n${mark}${row.verdict}  #${row.key}${row.test ? `  — ${row.test}` : ""}`,
    );
    for (const i of row.issues) {
      if (i.field === "states") {
        for (const d of i.detail) console.log(`     states  ${d}`);
        continue;
      }
      const parts = [`dom=${q(i.dom)}`, `native=${q(i.native)}`];
      if (i.raw !== undefined) parts.push(`raw=${q(i.raw)}`);
      if (i.spec != null) parts.push(`spec=${q(i.spec)}`);
      console.log(`     ${i.field.padEnd(11)} ${parts.join("  ")}`);
    }
    for (const h of row.hints) console.log(`     ↳ ${h}`);
  }
  if (res.tabs?.differs) {
    const at = res.tabs.firstDivergence;
    console.log(`\n✗ tab order diverges at stop ${at + 1}`);
    console.log(
      `     dom      ${res.tabs.dom.slice(Math.max(0, at - 2), at + 4).join(" → ") || "(none)"}`,
    );
    console.log(
      `     chromium ${res.tabs.chromium.slice(Math.max(0, at - 2), at + 4).join(" → ") || "(none)"}`,
    );
  }
}

const q = (v) => (v == null ? "—" : `"${v}"`);

// ---------------------------------------------------------------------------

const inputs = expandInputs();
const browser = await launch(opts.chromium);
let failed = false;
try {
  for (const input of inputs) {
    const page = await browser.newPage();
    try {
      const res = await probePage(page, input);
      failed ||= res.domGap > 0 || Boolean(res.tabs?.differs);
      if (opts.json) console.log(JSON.stringify(res));
      else printPage(res);
    } catch (err) {
      failed = true;
      console.log(
        `ERR   ${input.label}  ${err instanceof Error ? err.message.split("\n")[0] : err}`,
      );
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
