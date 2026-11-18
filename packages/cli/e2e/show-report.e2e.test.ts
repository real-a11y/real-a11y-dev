/**
 * End-to-end for `show-report` through the built bin: the server, the viewer
 * build the bin ships with, how the command stops, and the page in a browser.
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type Page } from "playwright";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

const BIN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../dist/index.js",
);

interface Running {
  child: ChildProcess;
  url: string;
  stderr: () => string;
  exited: Promise<number | null>;
}

let cwd: string;
const running: ChildProcess[] = [];

/** Start the command and wait for the URL it prints on stdout. */
function showReport(args: string[] = []): Promise<Running> {
  const child = spawn(
    process.execPath,
    [BIN, "show-report", "--no-open", "--port", "0", ...args],
    { cwd, env: { ...process.env, NO_COLOR: "1" }, windowsHide: true },
  );
  running.push(child);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => (stderr += chunk));
  const exited = new Promise<number | null>((done) =>
    child.on("exit", (code) => done(code)),
  );
  return new Promise((done, fail) => {
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!stdout.includes("\n")) return;
      done({ child, url: stdout.trim(), stderr: () => stderr, exited });
    });
    void exited.then((code) =>
      fail(new Error(`exited ${code} before serving: ${stderr}`)),
    );
  });
}

function runCli(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd, env: { ...process.env, NO_COLOR: "1" }, windowsHide: true },
      (error, stdout, stderr) => {
        const code =
          typeof error?.code === "number" ? error.code : error ? 2 : 0;
        done({ code, stdout, stderr });
      },
    );
  });
}

function writeRecord(name: string): void {
  const dir = join(cwd, "a11y-snapshots", "records", "src-a-test-ts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    JSON.stringify({ version: 2, test: name, file: "src/a.test.ts" }),
  );
}

const recordsFolder = (): string =>
  join(cwd, "a11y-snapshots", "records", "src-a-test-ts");

/** A record the page can draw, as the reporter writes one. */
function writeSnapshot(test: string, sequence = 1): void {
  const node = (
    id: string,
    parentId: string | null,
    childIds: string[],
    role: string,
    name: string,
  ) => ({
    id,
    parentId,
    childIds,
    depth: parentId ? 1 : 0,
    a11y: {
      role,
      name,
      description: "",
      states: {},
      properties: {},
      isExposedToAT: true,
    },
  });
  mkdirSync(recordsFolder(), { recursive: true });
  writeFileSync(
    join(recordsFolder(), `${test}.json`),
    JSON.stringify({
      version: 2,
      file: "src/a.test.ts",
      test,
      index: 1,
      sequence,
      kind: "tree",
      text: `main\n  button "${test}"`,
      recordedAt: new Date().toISOString(),
      tree: {
        rootId: "a",
        source: { producer: "dom" },
        nodes: [
          ["a", node("a", null, ["b"], "main", "")],
          ["b", node("b", "a", [], "button", test)],
        ],
      },
    }),
  );
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "real-a11y-show-report-e2e-"));
});

afterEach(async () => {
  // Windows won't delete a folder a running process has as its cwd.
  await Promise.all(
    running.splice(0).map(
      (child) =>
        new Promise<void>((done) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            done();
            return;
          }
          child.once("exit", () => done());
          child.kill("SIGKILL");
        }),
    ),
  );
  rmSync(cwd, { recursive: true, force: true, maxRetries: 5 });
});

describe("real-a11y show-report", () => {
  it("ships the viewer it serves", async () => {
    writeRecord("one.json");
    const { url } = await showReport();

    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const page = await (await fetch(url)).text();
    expect(page).toContain('<div id="app"></div>');

    const script = await fetch(`${url}viewer.js`);
    expect(script.status).toBe(200);
    expect(await script.text()).toContain("/__records/events");
    expect((await fetch(`${url}viewer.css`)).status).toBe(200);

    const data = (await (await fetch(`${url}__records`)).json()) as {
      records: { id: string }[];
    };
    expect(data.records.map((r) => r.id)).toEqual(["src-a-test-ts/one.json"]);
  });

  it("waits for a first run, and says so", async () => {
    const { url, stderr } = await showReport();
    const data = (await (await fetch(`${url}__records`)).json()) as {
      records: unknown[];
    };
    expect(data.records).toEqual([]);
    await expect.poll(stderr).toContain("no snapshots recorded yet");
    expect(existsSync(join(cwd, "a11y-snapshots"))).toBe(false);
  });

  it("reads a folder you name", async () => {
    mkdirSync(join(cwd, "reports", "records", "src"), { recursive: true });
    writeFileSync(
      join(cwd, "reports", "records", "src", "a.json"),
      JSON.stringify({ version: 2, test: "a", file: "src/a.test.ts" }),
    );
    const { url } = await showReport(["reports"]);
    const data = (await (await fetch(`${url}__records`)).json()) as {
      records: { id: string }[];
    };
    expect(data.records.map((r) => r.id)).toEqual(["src/a.json"]);
  });

  // A signal can't be delivered to a process on Windows: `kill` ends it.
  it.skipIf(process.platform === "win32")(
    "stops cleanly on Ctrl+C",
    async () => {
      const { child, stderr, exited } = await showReport();
      child.kill("SIGINT");
      expect(await exited).toBe(0);
      expect(stderr()).not.toContain("interrupted");
    },
  );

  // npx forwards the signal the terminal has already sent to the whole group.
  it.skipIf(process.platform === "win32")(
    "takes a second signal during the stop as the same Ctrl+C",
    async () => {
      const { child, stderr, exited } = await showReport();
      child.kill("SIGINT");
      child.kill("SIGINT");
      expect(await exited).toBe(0);
      expect(stderr()).not.toContain("interrupted");
    },
  );

  it("exits 2 on a URL, and names the commands that take one", async () => {
    const { code, stderr } = await runCli([
      "show-report",
      "https://example.com",
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain("not a URL");
    expect(stderr).toContain("real-a11y snapshot <url>");
  });

  it("exits 2 on a folder that isn't there", async () => {
    const { code, stderr } = await runCli(["show-report", "missing"]);
    expect(code).toBe(2);
    expect(stderr).toContain("no such folder");
  });

  it("exits 2 on a bad port", async () => {
    const { code, stderr } = await runCli(["show-report", "--port", "99999"]);
    expect(code).toBe(2);
    expect(stderr).toContain("--port expects");
  });

  it("is listed in the help", async () => {
    const root = await runCli(["--help"]);
    expect(root.stdout).toContain("show-report [dir]");
    const own = await runCli(["show-report", "--help"]);
    expect(own.code).toBe(0);
    expect(own.stdout).toContain("Usage: real-a11y show-report [dir] [flags]");
  });

  describe("in a browser", () => {
    let browser: Browser;

    beforeAll(async () => {
      browser = await chromium.launch({
        executablePath: process.env.REAL_A11Y_CHROME_PATH || undefined,
      });
    });

    afterAll(async () => {
      await browser.close();
    });

    const listed = (page: Page, test: string) =>
      page.getByRole("button", { name: test, exact: false });
    const focused = (page: Page) =>
      page.evaluate(() => document.activeElement?.className ?? "");

    /** Headless tabs all count as showing: this is what switching away does. */
    const setHidden = (page: Page, hidden: boolean) =>
      page.evaluate((value) => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => value,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      }, hidden);

    it("draws the records with nothing logged, and follows new ones", async () => {
      writeSnapshot("first");
      const { url } = await showReport();
      const page = await browser.newPage();
      const problems: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") problems.push(message.text());
      });
      page.on("pageerror", (error) => problems.push(error.message));

      await page.goto(url);
      await listed(page, "first").waitFor();
      writeSnapshot("second", 2);
      await listed(page, "second").waitFor();

      expect(problems).toEqual([]);
      await page.close();
    });

    it("loads with another tool's JSON in the folder", async () => {
      writeSnapshot("first");
      writeFileSync(join(cwd, "vercel.json"), JSON.stringify({ version: 2 }));
      const { url } = await showReport(["."]);
      const page = await browser.newPage();
      await page.goto(url);
      await listed(page, "first").waitFor();
      await page.close();
    });

    it("keeps keyboard focus on the open record through its rerun", async () => {
      writeSnapshot("first");
      writeSnapshot("second", 2);
      const { url } = await showReport();
      const page = await browser.newPage();
      await page.goto(url);
      await listed(page, "second").focus();
      await page.keyboard.press("Enter");

      rmSync(recordsFolder(), { recursive: true });
      await page
        .getByRole("status")
        .filter({ hasText: "Not in the latest records" })
        .waitFor();
      expect(await focused(page)).toContain("sv-record");

      writeSnapshot("first");
      writeSnapshot("second", 2);
      await page
        .getByRole("status")
        .filter({ hasText: "Not in the latest records" })
        .waitFor({ state: "detached" });
      expect(await focused(page)).toContain("sv-record");
      await page.close();
    });

    it("holds no connection in a hidden tab, so a seventh tab loads", async () => {
      writeSnapshot("first");
      const { url } = await showReport();
      // One context, as one browser profile: the limit is per origin in it.
      const context = await browser.newContext();
      const tabs: Page[] = [];
      for (let i = 0; i < 6; i++) {
        const tab = await context.newPage();
        await tab.goto(url);
        await listed(tab, "first").waitFor();
        await setHidden(tab, true);
        tabs.push(tab);
      }

      const seventh = await context.newPage();
      await seventh.goto(url, { timeout: 10_000 });
      await listed(seventh, "first").waitFor();

      writeSnapshot("second", 2);
      await setHidden(tabs[0], false);
      await listed(tabs[0], "second").waitFor();
      await context.close();
    });

    it("says when the server has stopped", async () => {
      writeSnapshot("first");
      const { url, child, exited } = await showReport();
      const page = await browser.newPage();
      await page.goto(url);
      await listed(page, "first").waitFor();

      child.kill();
      await exited;
      await page.getByRole("status").filter({ hasText: "stopped" }).waitFor();
      await listed(page, "first").waitFor();
      await page.close();
    });

    it("says how many records of another release it left out", async () => {
      writeSnapshot("first");
      writeFileSync(
        join(recordsFolder(), "old.json"),
        JSON.stringify({ version: 1, test: "old", file: "src/a.test.ts" }),
      );
      const { url } = await showReport();
      const page = await browser.newPage();
      await page.goto(url);
      await listed(page, "first").waitFor();
      await page.getByText("1 record from another release").waitFor();
      await page.close();
    });

    it("names the folder you gave it in the empty state", async () => {
      mkdirSync(join(cwd, "reports", "a11y"), { recursive: true });
      const { url } = await showReport(["reports/a11y"]);
      const page = await browser.newPage();
      await page.goto(url);
      await page.getByText('outputDir: "reports/a11y"').first().waitFor();
      await page.close();
    });
  });
});
