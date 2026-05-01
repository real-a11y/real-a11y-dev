// Smoke-test that every Vite-based example's dev server resolves workspace
// imports through pnpm symlinks. Catches the class of "Failed to resolve
// entry for package …" bug that production `vite build` / publint / attw
// don't reproduce — those use different resolvers than the dev server's
// import-analysis pipeline.
//
// For each example with `"dev": "vite"` in its package.json:
//   1. Start `pnpm exec vite --port <free>` in the example dir.
//   2. Wait for "ready in" on stdout.
//   3. Hit `/` and a transformed source URL that pulls workspace deps in.
//   4. Stop the server.
//   5. Fail if the captured stdout/stderr contains `Failed to resolve`,
//      `Internal server error`, or `Pre-transform error`.
//
// Run via `pnpm examples:dev-smoke`. Wired into CI as a separate step.
//
// Note: this needs each example's workspace deps already built (their
// `dist/`). CI runs `pnpm verify` before the smoke step, which builds
// every `packages/*` package as a side effect.

import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");
const examplesDir = resolve(repoRoot, "examples");

const FAILURE_PATTERNS = [
  /Failed to resolve/,
  /Internal server error/,
  /Pre-transform error/,
  /Cannot find package/,
  /\bENOENT\b/,
];

async function findViteExamples() {
  const out = [];
  for (const entry of await readdir(examplesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = resolve(examplesDir, entry.name, "package.json");
    let pkg;
    try {
      pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    } catch {
      continue;
    }
    if (pkg.scripts?.dev !== "vite") continue;
    out.push({ dir: resolve(examplesDir, entry.name), name: pkg.name });
  }
  return out;
}

async function freePort() {
  return new Promise((resolveP, rejectP) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", rejectP);
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolveP(port));
    });
  });
}

function smokeOne(example, port) {
  return new Promise((resolveOne) => {
    const log = [];
    const child = spawn(
      "pnpm",
      ["exec", "vite", "--port", String(port), "--strictPort"],
      {
        cwd: example.dir,
        shell: process.platform === "win32",
        env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
      },
    );

    let resolved = false;
    let readyResolver;
    const ready = new Promise((r) => (readyResolver = r));

    const onChunk = (chunk) => {
      const text = chunk.toString();
      log.push(text);
      // Vite ignores NO_COLOR/FORCE_COLOR in some shells, so strip ANSI
      // before matching — otherwise `ready in \x1b[1m214\x1b[22m ms` fails
      // a naive `\d+` regex.
      const plain = text.replace(/\x1b\[[0-9;]*m/g, "");
      if (!resolved && /ready in \d+ ms/.test(plain)) {
        resolved = true;
        readyResolver();
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        log.push("\n[timeout] vite dev did not become ready within 30s\n");
        readyResolver();
      }
    }, 30_000);

    ready.then(async () => {
      clearTimeout(timeoutId);

      // Touch the entry the example bootstraps from, then ask Vite to
      // transform the workspace package's dist file. That second request
      // is the one that exercises the symlink-aware resolver — exactly
      // what failed for inspector through pnpm on Windows.
      const probes = ["/", "/src/main.tsx"];
      const pkgRoot = await findFirstWorkspacePackage(example.dir);
      if (pkgRoot) probes.push(`/node_modules/${pkgRoot}/dist/index.js`);

      for (const path of probes) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}${path}`, {
            redirect: "follow",
          });
          await res.text();
        } catch {
          // network blip — the log check below catches the real failure
        }
      }

      // Give Vite a moment to surface deferred transform errors.
      await new Promise((r) => setTimeout(r, 1500));

      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000);

      child.on("exit", () => {
        const captured = log.join("");
        const plain = captured.replace(/\x1b\[[0-9;]*m/g, "");
        const matched = FAILURE_PATTERNS.find((p) => p.test(plain));
        if (matched) {
          console.error(`\n──────── ${example.name}: FAIL ────────`);
          console.error(`pattern: ${matched}`);
          console.error(captured);
          resolveOne(false);
        } else if (!resolved) {
          console.error(`\n──────── ${example.name}: FAIL ────────`);
          console.error("vite dev did not start within timeout");
          console.error(captured);
          resolveOne(false);
        } else {
          console.log(`──────── ${example.name}: OK ────────`);
          resolveOne(true);
        }
      });
    });
  });
}

// Pick a `@real-a11y-dev/*` workspace dep from the example's package.json
// so we can deliberately probe its transformed dist through the dev server.
async function findFirstWorkspacePackage(dir) {
  const pkg = JSON.parse(await readFile(resolve(dir, "package.json"), "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const [name, version] of Object.entries(deps)) {
    if (name.startsWith("@real-a11y-dev/") && version === "workspace:*") {
      return name;
    }
  }
  return null;
}

const examples = await findViteExamples();
if (examples.length === 0) {
  console.error("No Vite-based examples found.");
  process.exit(1);
}

let failed = 0;
for (const example of examples) {
  const port = await freePort();
  const ok = await smokeOne(example, port);
  if (!ok) failed++;
}

if (failed > 0) {
  console.error(`\n${failed} example(s) failed the dev-server smoke test.`);
  process.exit(1);
}
console.log(`\nAll ${examples.length} example(s) start cleanly.`);
