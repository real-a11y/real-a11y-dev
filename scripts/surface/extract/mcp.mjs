// The MCP server's public surface — asked for over the protocol.
//
// Not read out of the source, and not read off the server object's internals:
// this boots the real server, connects a real client to it in memory, and calls
// `tools/list`. The manifest is then literally the response an agent gets, with
// the JSON Schemas the SDK derived from the zod definitions.
//
// A useful side effect: extraction fails if the server can't start. A broken
// registration is caught here, before it reaches a release.

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { loadTs } from "../ts-load.mjs";

/**
 * A `SessionManager` whose every method throws if actually called.
 *
 * A MANAGER, not a bare session, because that is what the shipped bin wires
 * (`index.ts` builds an `McpSessionManager`) — and the two paths advertise
 * different text: on the single-session path the tools say so in `session`'s
 * description. Extracting from a bare session would put the embedder-only
 * wording in the manifest the docs are checked against.
 *
 * The methods exist (registration discriminates on their shape) but only tool
 * *handlers* invoke them, and we never invoke a handler. If registration ever
 * starts running one, this fails loudly rather than quietly extracting a
 * surface built from `undefined`.
 */
function stubManager() {
  const refuse = (method) => () => {
    throw new Error(
      `The surface extractor's stub manager was used (.${method}). ` +
        `Tool registration is supposed to be side-effect free — if that ` +
        `changed, the extractor needs a real session.`,
    );
  };
  return {
    run: refuse("run"),
    list: refuse("list"),
    stop: refuse("stop"),
    stopAll: refuse("stopAll"),
    checkpoints: refuse("checkpoints"),
    shutdown: refuse("shutdown"),
  };
}

export async function extractMcp(repoRoot) {
  const pkgDir = join(repoRoot, "packages", "mcp");
  const { server: mod } = await loadTs(pkgDir, { server: "src/server.ts" });

  // Resolved from the MCP package's own node_modules — the extractor must use
  // the exact SDK version the server was built against. `require.resolve`
  // answers with a filesystem path, which on Windows is not a URL the ESM
  // loader accepts, hence `pathToFileURL`.
  const require = (await import("node:module")).createRequire(
    join(pkgDir, "package.json"),
  );
  const sdk = (specifier) =>
    import(pathToFileURL(require.resolve(specifier)).href);
  const { Client } = await sdk("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await sdk(
    "@modelcontextprotocol/sdk/inMemory.js",
  );

  const server = mod.buildServer(stubManager());
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "real-a11y-surface", version: "0.0.0" });

  try {
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const { tools } = await client.listTools();
    return {
      tools: tools
        .map((tool) => ({
          name: tool.name,
          title: tool.title ?? null,
          description: tool.description ?? "",
          inputSchema: tool.inputSchema,
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}
