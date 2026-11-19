import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CliError } from "../exit.js";

import {
  DEFAULT_PORT,
  hasRecords,
  loopbackHosts,
  recordReader,
  startReportServer,
  type ReportServer,
} from "./server.js";

const viewer = { js: "/* viewer script */", css: "/* viewer style */" };

let root: string;
let recordsDir: string;
const open: ReportServer[] = [];

const RECORD = { version: 2, test: "a test", file: "src/a.test.ts" };

const readRecords = (dir: string): Record<string, unknown>[] =>
  recordReader(dir)().map(
    (json) => JSON.parse(json) as Record<string, unknown>,
  );

function writeRecord(name: string, record: object = RECORD): void {
  const dir = join(recordsDir, "src-a-test-ts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(record));
}

async function start(port = 0): Promise<ReportServer> {
  const server = await startReportServer({ recordsDir, viewer, port });
  open.push(server);
  return server;
}

/** A raw request: `fetch` won't send a `Host` of the caller's choosing. */
function rawRequest(
  url: string,
  options: { host?: string; method?: string; path?: string } = {},
): Promise<{ status: number; body: string }> {
  const { port, pathname } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: options.path ?? pathname,
        method: options.method ?? "GET",
        headers: options.host ? { host: options.host } : {},
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** Resolves on the stream's first `records` event. */
async function nextChange(url: string): Promise<{
  arrived: Promise<string>;
  stop: () => void;
}> {
  const controller = new AbortController();
  const res = await fetch(`${url}__records/events`, {
    signal: controller.signal,
  });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const arrived = (async () => {
    let text = "";
    while (!text.includes("event: records")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += value;
    }
    return text;
  })();
  return { arrived, stop: () => controller.abort() };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "real-a11y-show-report-"));
  recordsDir = join(root, "records");
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((server) => server.close()));
  rmSync(root, { recursive: true, force: true });
});

describe("readRecords", () => {
  it("gives each record its path in the folder as its id", () => {
    writeRecord("one.json");
    expect(readRecords(recordsDir)).toEqual([
      { ...RECORD, id: "src-a-test-ts/one.json" },
    ]);
  });

  it("keeps a record of another version, for the viewer to say so", () => {
    writeRecord("old.json", { ...RECORD, version: 1 });
    expect(readRecords(recordsDir)).toHaveLength(1);
  });

  it("skips another tool's file that has a version too", () => {
    writeRecord("vercel.json", { version: 2 });
    writeRecord("angular.json", { version: 1, projects: {} });
    expect(readRecords(recordsDir)).toEqual([]);
  });

  it("reads a file again only once it has changed", () => {
    writeRecord("one.json");
    writeRecord("two.json");
    const read = recordReader(recordsDir);
    const before = read();

    writeRecord("two.json", { ...RECORD, test: "changed" });
    const after = read();

    expect(after[0]).toBe(before[0]);
    expect(JSON.parse(after[1])).toMatchObject({ test: "changed" });
  });

  it("forgets a file that is gone, and reads a half-written one again", () => {
    writeRecord("one.json");
    const folder = join(recordsDir, "src-a-test-ts");
    writeFileSync(join(folder, "two.json"), '{"versi');
    const read = recordReader(recordsDir);
    expect(read()).toHaveLength(1);

    writeRecord("two.json");
    expect(read()).toHaveLength(2);

    rmSync(join(folder, "one.json"));
    expect(read()).toHaveLength(1);
  });

  it("skips what isn't a record", () => {
    writeRecord("no-version.json", { name: "package" });
    writeRecord("list.json", [1, 2]);
    writeRecord("null.json", null as unknown as object);
    writeFileSync(join(recordsDir, "src-a-test-ts", "half.json"), '{"versi');
    writeFileSync(join(recordsDir, "src-a-test-ts", "notes.txt"), "text");
    expect(readRecords(recordsDir)).toEqual([]);
  });

  it("stays out of node_modules and .git", () => {
    for (const folder of ["node_modules/pkg", ".git/x"]) {
      mkdirSync(join(recordsDir, folder), { recursive: true });
      writeFileSync(join(recordsDir, folder, "a.json"), JSON.stringify(RECORD));
    }
    expect(readRecords(recordsDir)).toEqual([]);
  });

  it("reads nothing from a folder that doesn't exist yet", () => {
    expect(readRecords(join(root, "missing"))).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "doesn't follow a link out of the folder",
    () => {
      const outside = join(root, "outside.json");
      writeFileSync(outside, JSON.stringify({ ...RECORD, secret: true }));
      writeRecord("real.json");
      symlinkSync(outside, join(recordsDir, "src-a-test-ts", "link.json"));
      expect(readRecords(recordsDir).map((r) => r.id)).toEqual([
        "src-a-test-ts/real.json",
      ]);
    },
  );
});

describe("loopbackHosts", () => {
  it("names the port", () => {
    expect([...loopbackHosts(9324)]).toEqual([
      "127.0.0.1:9324",
      "localhost:9324",
    ]);
  });

  it("takes the bare name on port 80, where a browser sends no port", () => {
    expect(loopbackHosts(80).has("127.0.0.1")).toBe(true);
    expect(loopbackHosts(80).has("localhost")).toBe(true);
    expect(loopbackHosts(80).has("localhost:80")).toBe(true);
    expect(loopbackHosts(9324).has("localhost")).toBe(false);
  });
});

describe("hasRecords", () => {
  it("says whether any record file is there", () => {
    expect(hasRecords(recordsDir)).toBe(false);
    writeRecord("one.json");
    expect(hasRecords(recordsDir)).toBe(true);
  });
});

describe("startReportServer", () => {
  it("serves the page, the viewer and the records", async () => {
    writeRecord("one.json");
    const { url } = await start();

    const page = await fetch(url);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain('<script src="/viewer.js"></script>');
    expect(html).toContain('href="/viewer.css"');
    // A browser asks for /favicon.ico otherwise, and logs the 404.
    expect(html).toContain('<link rel="icon" href="data:,">');

    expect(await (await fetch(`${url}viewer.js`)).text()).toBe(viewer.js);
    expect(await (await fetch(`${url}viewer.css`)).text()).toBe(viewer.css);

    const data = (await (await fetch(`${url}__records`)).json()) as {
      dir: string;
      records: { id: string }[];
    };
    expect(data.dir).toBe(recordsDir);
    expect(data.records.map((r) => r.id)).toEqual(["src-a-test-ts/one.json"]);
  });

  it("tells the page which folder you named", async () => {
    const named = await startReportServer({
      recordsDir,
      outputDir: 'reports\\"a11y"',
      viewer,
      port: 0,
    });
    open.push(named);
    const { url } = await start();

    const read = async (at: string) =>
      (await (await fetch(`${at}__records`)).json()) as {
        outputDir: string | null;
      };
    expect((await read(named.url)).outputDir).toBe('reports\\"a11y"');
    expect((await read(url)).outputDir).toBeNull();
  });

  it("listens on the loopback address alone", async () => {
    const { url } = await start();
    expect(new URL(url).hostname).toBe("127.0.0.1");
  });

  it("answers only to a loopback Host", async () => {
    const { url } = await start();
    const { port } = new URL(url);

    const allowed = await Promise.all(
      [`127.0.0.1:${port}`, `localhost:${port}`, `LOCALHOST:${port}`].map(
        (host) => rawRequest(`${url}__records`, { host }),
      ),
    );
    expect(allowed.map((r) => r.status)).toEqual([200, 200, 200]);

    const refused = await Promise.all(
      ["evil.example", `evil.example:${port}`, "127.0.0.1:1"].map((host) =>
        rawRequest(`${url}__records`, { host }),
      ),
    );
    expect(refused.map((r) => r.status)).toEqual([403, 403, 403]);
    expect(refused[0].body).not.toContain("records");
  });

  it("grants no cross-origin read and sets a strict policy", async () => {
    const { url } = await start();
    const res = await fetch(`${url}__records`, {
      headers: { origin: "https://evil.example" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
  });

  it("takes only GET and HEAD", async () => {
    const { url } = await start();
    const post = await rawRequest(`${url}__records`, { method: "POST" });
    expect(post.status).toBe(405);
    const head = await rawRequest(`${url}__records`, { method: "HEAD" });
    expect(head.status).toBe(200);
    const events = await rawRequest(`${url}__records/events`, {
      method: "HEAD",
    });
    expect(events.status).toBe(200);
  });

  it("serves no path it doesn't list", async () => {
    writeRecord("one.json");
    const { url } = await start();
    for (const path of [
      "/records/src-a-test-ts/one.json",
      "/src-a-test-ts/one.json",
      "/../records/src-a-test-ts/one.json",
      "/viewer.js/../../package.json",
      "/%2e%2e/package.json",
    ]) {
      const { status } = await rawRequest(url, { path });
      expect(status, path).toBe(404);
    }
  });

  it("ignores a query string", async () => {
    const { url } = await start();
    expect((await fetch(`${url}viewer.js?v=1`)).status).toBe(200);
  });

  it("says when a record is added", async () => {
    writeRecord("one.json");
    const { url } = await start();
    const { arrived, stop } = await nextChange(url);
    writeRecord("two.json");
    expect(await arrived).toContain("data: changed");
    stop();
  });

  it("doesn't announce what was written before the page connected", async () => {
    const { url } = await start();
    writeRecord("one.json");

    const controller = new AbortController();
    const res = await fetch(`${url}__records/events`, {
      signal: controller.signal,
    });
    const text = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let heard = "";
    const listen = (async () => {
      for (;;) heard += (await text.read()).value ?? "";
    })().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 1200));
    controller.abort();
    await listen;

    expect(heard).not.toContain("event: records");
  });

  it("says when a test run deletes the records and writes them again", async () => {
    writeRecord("one.json");
    const { url } = await start();

    const removed = await nextChange(url);
    rmSync(recordsDir, { recursive: true });
    await removed.arrived;
    removed.stop();

    const written = await nextChange(url);
    writeRecord("one.json");
    await written.arrived;
    written.stop();
  });

  it("starts before the records folder exists, and follows it", async () => {
    const { url } = await start();
    const { arrived, stop } = await nextChange(url);
    writeRecord("first.json");
    await arrived;
    stop();
    const data = (await (await fetch(`${url}__records`)).json()) as {
      records: unknown[];
    };
    expect(data.records).toHaveLength(1);
  });

  it("closes with a page still connected", async () => {
    const server = await startReportServer({ recordsDir, viewer, port: 0 });
    const { arrived } = await nextChange(server.url);
    await server.close();
    // The stream ends, however the client chooses to report that.
    await arrived.catch(() => {});
    await expect(fetch(server.url)).rejects.toThrow();
  });

  describe("when the port is taken", () => {
    let blocker: Server;
    const block = (port: number): Promise<number> =>
      new Promise((resolve, reject) => {
        blocker = createServer();
        blocker.once("error", reject);
        blocker.listen(port, "127.0.0.1", () =>
          resolve((blocker.address() as { port: number }).port),
        );
      });

    afterEach(async () => {
      await new Promise((resolve) => blocker.close(resolve));
    });

    it("fails on a port you asked for", async () => {
      const port = await block(0);
      const started = startReportServer({ recordsDir, viewer, port });
      await expect(started).rejects.toBeInstanceOf(CliError);
      await expect(started).rejects.toThrow(`port ${port}`);
    });

    it("takes any free port in place of the default", async () => {
      // Something else on this machine may hold it already, which is as good.
      await block(DEFAULT_PORT).catch(() => {});
      const server = await startReportServer({ recordsDir, viewer });
      open.push(server);
      expect(new URL(server.url).port).not.toBe(String(DEFAULT_PORT));
      expect((await fetch(server.url)).status).toBe(200);
    });
  });
});
