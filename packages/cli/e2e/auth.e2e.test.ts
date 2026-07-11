/**
 * End-to-end for authenticated auditing: a local fixture server whose /check
 * route renders "in" only when a session cookie is present, plus a /redirect
 * route that bounces to /check. Proves storage-state load, the logged-out
 * baseline, and — the security-critical one — that origin pinning refuses to
 * extract an authenticated page reached by a redirect off the audited origin.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/index.js");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      {
        env: {
          ...process.env,
          NO_COLOR: "1",
          FORCE_COLOR: "",
          GITHUB_ACTIONS: "",
          REAL_A11Y_MCP_ALLOW_FILE: "",
        },
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof error.code === "number" ? error.code : error ? 2 : 0;
        resolvePromise({ code, stdout, stderr });
      },
    );
  });
}

let server: Server;
let base: string;
let host: string;
let stateFile: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/check" });
      res.end();
      return;
    }
    const authed = (req.headers.cookie ?? "").includes("session=ok");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      authed
        ? "<main><h1>welcome back</h1></main>"
        : '<main><h1>please sign in</h1><a href="/login">Log in</a></main>',
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  host = `127.0.0.1:${port}`;
  base = `http://${host}`;

  const dir = mkdtempSync(join(tmpdir(), "real-a11y-auth-"));
  stateFile = join(dir, "auth.json");
  writeFileSync(
    stateFile,
    JSON.stringify({
      cookies: [
        {
          name: "session",
          value: "ok",
          domain: "127.0.0.1",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
  );
});

afterAll(() => {
  server.close();
});

describe("authenticated auditing (built bin)", () => {
  it("renders the logged-out page without a session", async () => {
    const { code, stdout } = await runCli(["tree", `${base}/check`]);
    expect(code).toBe(0);
    expect(stdout).toContain("please sign in");
    expect(stdout).not.toContain("welcome back");
  });

  it("renders the authenticated page with --storage-state", async () => {
    const { code, stdout } = await runCli([
      "tree",
      `${base}/check`,
      "--storage-state",
      stateFile,
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("welcome back");
  });

  it("follows a same-origin redirect under the default allowlist", async () => {
    const { code, stdout } = await runCli([
      "tree",
      `${base}/redirect`,
      "--storage-state",
      stateFile,
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("welcome back");
  });

  it("REFUSES to extract when a redirect leaves the audited origin", async () => {
    // Point the audit at a different-port origin that 302s to the real host.
    const decoy = createServer((_req, res) => {
      res.writeHead(302, { Location: `${base}/check` });
      res.end();
    });
    await new Promise<void>((r) => decoy.listen(0, "127.0.0.1", () => r()));
    const decoyPort = (decoy.address() as { port: number }).port;
    try {
      const { code, stdout, stderr } = await runCli([
        "tree",
        `http://127.0.0.1:${decoyPort}/`,
        "--storage-state",
        stateFile,
      ]);
      expect(code).toBe(2);
      // The authenticated content must NOT have been extracted or printed.
      expect(stdout).not.toContain("welcome back");
      expect(stderr).toContain("not an allowed audit origin");
    } finally {
      decoy.close();
    }
  });

  it("allows the cross-origin landing when --audit-origin permits it", async () => {
    const decoy = createServer((_req, res) => {
      res.writeHead(302, { Location: `${base}/check` });
      res.end();
    });
    await new Promise<void>((r) => decoy.listen(0, "127.0.0.1", () => r()));
    const decoyPort = (decoy.address() as { port: number }).port;
    try {
      const { code, stdout } = await runCli([
        "tree",
        `http://127.0.0.1:${decoyPort}/`,
        "--storage-state",
        stateFile,
        "--audit-origin",
        base,
      ]);
      expect(code).toBe(0);
      expect(stdout).toContain("welcome back");
    } finally {
      decoy.close();
    }
  });

  it("rejects --storage-state combined with --cdp before launching", async () => {
    const { code, stderr } = await runCli([
      "tree",
      `${base}/check`,
      "--storage-state",
      stateFile,
      "--cdp",
      "http://localhost:9222",
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain("can't be combined with --cdp");
  });

  it("errors clearly on a missing storage-state file", async () => {
    const { code, stderr } = await runCli([
      "tree",
      `${base}/check`,
      "--storage-state",
      join(tmpdir(), "does-not-exist-12345.json"),
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain("storage state file not found");
    expect(stderr).toContain("real-a11y login");
  });

  it("login refuses to run non-interactively (piped stdin)", async () => {
    const { code, stderr } = await runCli([
      "login",
      `${base}/check`,
      "--save",
      join(tmpdir(), "should-not-write.json"),
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain("login is interactive");
  });
});
