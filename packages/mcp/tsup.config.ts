import { defineConfig } from "tsup";

export default defineConfig({
  // `index` is the stdio bin (has a shebang); `server` is the importable API.
  // The browser session now lives in @real-a11y-dev/browser (imported by both
  // the CLI and this server), so it is no longer built or re-exported here.
  entry: ["src/index.ts", "src/server.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // playwright is a peer dep, resolved by the host — never bundle it.
  external: ["playwright"],
  // The session registry is a PRIVATE workspace package: npm can never resolve
  // it, so it must be bundled into the dist (it is a devDependency for the
  // same reason — a published "dependencies" entry would break installs).
  //
  // Because it is bundled, nothing inside it is importable by name from npm —
  // so anything a published consumer NEEDS from it is re-exported through
  // `server.ts` (`SessionRegistryError`, `RegistryShutdownError`,
  // `SessionInfo`). That matters for the public `SessionManager` contract: a
  // third-party manager signals refusals by throwing `SessionRegistryError`,
  // and an error class it cannot import is a contract it cannot implement.
  noExternal: ["@real-a11y-dev/session-registry"],
  banner: { js: "" },
});
