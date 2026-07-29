// Audit the built docs site through **Chromium's own accessibility tree**,
// using our own CLI, and fail on any finding the baseline hasn't accepted.
//
// ## Why this exists alongside the Playwright suite
//
// `tests/a11y.spec.ts` already gates every route with axe and with
// `@real-a11y-dev/testing`. Both of those compute the accessibility tree **in
// the page** — axe with its own implementation, ours with a DOM walk. Chromium
// computes a stricter one, and where they disagree the browser is what
// assistive tech actually gets.
//
// That gap shipped a real defect. The home page's three linked feature cards
// (`<a class="VPFeature">` around an `<article>`) had no accessible name in
// Chromium, because `article` does not support name-from-content. Both in-page
// implementations derived a name anyway, from the card's contents — so the tree
// baseline looked populated and axe's `link-name` rule passed the entire time
// the page was broken. Nothing in CI read the tree that disagreed. It took the
// PR diff bot, which reads the native tree from outside, to surface it.
//
// This script closes that. It is the same engine the CLI ships to users, run
// against our own site: the most direct dogfood available, and the only check
// here that sees what a screen reader on Chrome sees.
//
// ## Why it owns the server
//
// It starts its own `vitepress preview` on its own port and kills it on the way
// out, rather than reusing whatever is listening. `sirv` builds its file map
// once at startup, so a preview server left over from an earlier run serves a
// stale map: every hashed asset 404s, Vue never hydrates, and the whole site
// audits as broken in a way that looks like a real regression. That cost real
// time once already. A server this script started is a server it can trust.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ROUTES } from "./audit-routes.mjs";

const websiteDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(websiteDir, "..");
const cli = join(repoRoot, "packages", "cli", "dist", "index.js");
const baseline = join(websiteDir, "tests", "a11y-native-baseline.json");
const artifact = join(websiteDir, "test-results", "native-audit.json");

// Not 5173: that is the Playwright suite's port. Sharing it means whichever
// runs second either fights for the port or silently audits the other's build.
const PORT = Number(process.env.A11Y_NATIVE_PORT ?? 5174);
const BASE = `http://localhost:${PORT}`;

const updating = process.argv.includes("--update-baseline");

// Checked before anything is spawned. Reached through a running server and a
// failed `node <missing file>`, this surfaces as an exit code indistinguishable
// from "the site has findings" — which is the one thing this script must never
// be ambiguous about.
if (!existsSync(cli)) {
  console.error(
    `The native audit needs the CLI built:\n  ${cli}\n\n` +
      `  pnpm build && pnpm --filter @real-a11y-dev/website build\n`,
  );
  process.exit(1);
}

/**
 * The `/assets/app.<hash>.js` the build on disk references — the fingerprint of
 * THIS build, and the thing a served page has to agree with.
 */
function expectedBundle() {
  const html = readFileSync(join(websiteDir, ".vitepress", "dist", "index.html"), "utf8"); // prettier-ignore
  const match = /assets\/app\.[A-Za-z0-9_-]+\.js/.exec(html);
  if (!match) throw new Error("no /assets/app.*.js in the built index.html");
  return match[0];
}

/**
 * Resolve once a server is answering **with the build we just made**.
 *
 * Liveness is not enough, and settling for it is how this goes wrong. Two ways:
 *
 * - Something already holds the port. `vitepress preview` does not fail — it
 *   moves to the next free one. A liveness poll then gets a cheerful 200 from
 *   the squatter and audits whatever *it* serves.
 * - A `vitepress preview` from an earlier run is still up. `sirv` builds its
 *   file map once at startup, so it serves an index.html whose hashed assets it
 *   no longer knows: every one 404s, Vue never hydrates, and all 43 routes
 *   audit as broken. That reads exactly like a real regression and cost real
 *   time once already.
 *
 * Comparing the served page's bundle hash against the one on disk catches both,
 * and says which.
 */
async function waitForOurServer(url, died, timeoutMs = 30_000) {
  const bundle = expectedBundle();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (died.code !== null) {
      throw new Error(
        `the preview server exited (code ${died.code}) before serving ${url}.`,
      );
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const html = await res.text();
        if (html.includes(bundle)) return;
        throw new Error(
          `something is serving ${url}, but not this build — it does not reference ${bundle}. ` +
            `Either port ${PORT} was already taken (so vitepress moved to another one) or a stale ` +
            `preview server is up. Free the port, or set A11Y_NATIVE_PORT.`,
        );
      }
    } catch (err) {
      // A wrong-build answer is a verdict, not a retry.
      if (err instanceof Error && err.message.includes("not this build"))
        throw err;
    }
    if (Date.now() > deadline) {
      throw new Error(`preview server never came up at ${url}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}

const server = spawn(
  "pnpm",
  ["exec", "vitepress", "preview", "--port", String(PORT)],
  { cwd: websiteDir, stdio: "ignore" },
);

// A server that dies on its own (EADDRINUSE, a missing build) must not read as
// "still starting" — see `waitForOurServer`.
const died = { code: null };
server.on("exit", (exitCode) => {
  died.code = exitCode ?? 1;
});

// Kill the server on every exit path, including Ctrl-C and an exception —
// leaving one behind is the stale-map hazard described above.
let stopped = false;
const stopServer = () => {
  if (stopped) return;
  stopped = true;
  server.kill("SIGTERM");
};
process.on("exit", stopServer);
process.on("SIGINT", () => {
  stopServer();
  process.exit(130);
});

let code;
// Whether the audit itself ran. A non-zero `code` means two very different
// things — the site has findings, or the run never got off the ground — and
// only the first one is worth printing baseline advice about.
let audited = false;
try {
  await waitForOurServer(`${BASE}/`, died);
  mkdirSync(dirname(artifact), { recursive: true });

  audited = true;
  code = await run(
    process.execPath,
    [
      cli,
      "snapshot",
      // The pages come from A11Y_PAGES (below), not positionals — positionals
      // would take precedence and carry no `name`.
      "--no-config",
      // The same wait `a11y.spec.ts` uses. VitePress fills several attributes
      // only after hydration — the appearance switch's `title` among them — so
      // reading at `load` measures a page no user ever sees, and reports the
      // half-built state as missing labels. Deterministically, on whichever
      // routes are heaviest: this is not a flake to retry past, it is the
      // wrong instant to measure.
      "--wait-until",
      "networkidle",
      "--fail-on",
      "error",
      // `--update-baseline` is a boolean that rewrites whatever `--baseline`
      // points at, so the path stays on `--baseline` in both modes.
      "--baseline",
      baseline,
      ...(updating ? ["--update-baseline"] : []),
      "--output",
      artifact,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        // Name each page by its ROUTE, not its URL. A finding's fingerprint is
        // built from the page name, so naming by URL would bake `localhost:5174`
        // into every baseline entry — and the baseline would stop matching the
        // moment anyone ran this on another port. The route is the stable
        // identity: same on every machine, and readable in the baseline diff.
        A11Y_PAGES: JSON.stringify(
          ROUTES.map((route) => ({ name: route, url: BASE + route })),
        ),
      },
    },
  );
} catch (err) {
  // The run never happened. Say so plainly rather than letting an unhandled
  // rejection print a stack that reads like a site failure — this and a real
  // finding have nothing in common but the exit code.
  console.error(`\nThe native audit could not run: ${err.message}`);
  code = 1;
} finally {
  stopServer();
}

if (audited && code !== 0 && !updating) {
  console.error(
    `\nThe native tree disagrees with the site. Findings above; full artifact at\n` +
      `  ${artifact}\n\n` +
      `If a finding is accepted debt rather than a regression, re-run with\n` +
      `  pnpm --filter @real-a11y-dev/website audit:native:update\n` +
      `and commit the baseline — the diff is the record of what was accepted.\n`,
  );
}

process.exit(code);
