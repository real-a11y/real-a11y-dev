/**
 * The server behind `real-a11y show-report`: the snapshot viewer's build, the
 * records a test run wrote, and word of when they change.
 *
 * Records describe the app under test, so only this machine's browser may read
 * them. It listens on the loopback address alone, answers only to a loopback
 * `Host` (a page on another site can rebind its own name to 127.0.0.1, and
 * would otherwise count as same-origin here), grants no cross-origin reads, and
 * serves a fixed list of paths: nothing in a URL ever names a file.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { join, relative } from "node:path";

import { CliError } from "../exit.js";

const HOST = "127.0.0.1";

/** One above `playwright show-report`'s, so the two can run side by side. */
export const DEFAULT_PORT = 9324;

/** How often the records are checked. A deleted folder ends a file watcher,
 *  and a test run deletes this one whenever it starts. */
const POLL_MS = 500;

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>A11y snapshots</title>
<link rel="stylesheet" href="/viewer.css">
</head>
<body>
<div id="app"></div>
<script src="/viewer.js"></script>
</body>
</html>
`;

const EVERY_RESPONSE = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

/** The viewer's two files: its classic script and its stylesheet. */
export interface ViewerAssets {
  js: string;
  css: string;
}

export interface ReportServerOptions {
  recordsDir: string;
  viewer: ViewerAssets;
  /** Where to listen. Unset: `DEFAULT_PORT`, or any free port if that's taken. */
  port?: number;
}

export interface ReportServer {
  url: string;
  close: () => Promise<void>;
}

/** Folders no test run records into, and too big to read twice a second:
 *  `show-report .` starts at a project's root. */
const NEVER_RECORDS = new Set(["node_modules", ".git"]);

/** The `Host` a page served on `port` sends. A browser leaves out port 80. */
export function loopbackHosts(port: number): ReadonlySet<string> {
  const names = [HOST, "localhost"];
  const withPort = names.map((name) => `${name}:${port}`);
  return new Set(port === 80 ? [...names, ...withPort] : withPort);
}

/** Every record file under `dir`. Links aren't followed out of the folder. */
function recordFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (folder: string): void => {
    let entries;
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      return; // Not written yet, or a run has just deleted it.
    }
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!NEVER_RECORDS.has(entry.name)) walk(path);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        found.push(path);
      }
    }
  };
  walk(dir);
  return found;
}

/** Whether a test run has recorded anything here yet. */
export function hasRecords(dir: string): boolean {
  return recordFiles(dir).length > 0;
}

/** What changes when any record does. */
function fingerprint(dir: string): string {
  const stamps = recordFiles(dir).map((path) => {
    try {
      const { size, mtimeMs } = statSync(path);
      return `${path}:${size}:${mtimeMs}`;
    } catch {
      return "";
    }
  });
  return stamps.sort().join("\n");
}

function parseRecord(path: string): Record<string, unknown> | null {
  try {
    const record = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    > | null;
    return typeof record?.version === "number" ? record : null;
  } catch {
    return null; // Half written: the next change brings the rest.
  }
}

/**
 * Every record under `dir`, with its path there as its id. Whatever its
 * version: the viewer knows which it can draw, and says so about the rest.
 */
export function readRecords(dir: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const path of recordFiles(dir)) {
    const record = parseRecord(path);
    const id = relative(dir, path).split("\\").join("/");
    if (record) records.push({ ...record, id });
  }
  return records;
}

function send(
  res: ServerResponse,
  status: number,
  type: string,
  body: string,
): void {
  res.writeHead(status, {
    ...EVERY_RESPONSE,
    "content-type": type,
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function bind(server: Server, port: number | undefined): Promise<void> {
  if (port === undefined) {
    // Any port does when nobody asked for one in particular.
    await listen(server, DEFAULT_PORT).catch(() => listen(server, 0));
    return;
  }
  try {
    await listen(server, port);
  } catch (err) {
    throw new CliError(
      `couldn't listen on port ${port}: ${(err as Error).message}`,
      "pick another with --port, or --port 0 for any free one",
    );
  }
}

/** Start serving. Resolves once the server is listening. */
export async function startReportServer({
  recordsDir,
  viewer,
  port,
}: ReportServerOptions): Promise<ReportServer> {
  const listening = new Set<ServerResponse>();
  let hosts: ReadonlySet<string> = new Set();

  const events = (req: IncomingMessage, res: ServerResponse): void => {
    res.writeHead(200, {
      ...EVERY_RESPONSE,
      "content-type": "text/event-stream",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.write(": connected\n\n");
    listening.add(res);
    req.on("close", () => listening.delete(res));
  };

  const server = createServer((req, res) => {
    if (!hosts.has(req.headers.host?.toLowerCase() ?? "")) {
      send(res, 403, "text/plain; charset=utf-8", "Forbidden\n");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("allow", "GET, HEAD");
      send(res, 405, "text/plain; charset=utf-8", "Method not allowed\n");
      return;
    }
    switch ((req.url ?? "/").split("?", 1)[0]) {
      case "/":
        send(res, 200, "text/html; charset=utf-8", PAGE);
        return;
      case "/viewer.js":
        send(res, 200, "text/javascript; charset=utf-8", viewer.js);
        return;
      case "/viewer.css":
        send(res, 200, "text/css; charset=utf-8", viewer.css);
        return;
      case "/__records":
        send(
          res,
          200,
          "application/json; charset=utf-8",
          JSON.stringify({
            dir: recordsDir,
            records: readRecords(recordsDir),
          }),
        );
        return;
      case "/__records/events":
        events(req, res);
        return;
      default:
        send(res, 404, "text/plain; charset=utf-8", "Not found\n");
    }
  });

  await bind(server, port);
  const bound = (server.address() as { port: number }).port;
  hosts = loopbackHosts(bound);

  let seen = fingerprint(recordsDir);
  const poll = setInterval(() => {
    if (listening.size === 0) return;
    const now = fingerprint(recordsDir);
    if (now === seen) return;
    seen = now;
    // An event with no data never reaches the page's listener.
    for (const res of listening) res.write("event: records\ndata: changed\n\n");
  }, POLL_MS);

  return {
    url: `http://${HOST}:${bound}/`,
    close: () =>
      new Promise((resolve) => {
        clearInterval(poll);
        server.close(() => resolve());
        // An open page's event stream would hold the server open for good.
        server.closeAllConnections();
      }),
  };
}
