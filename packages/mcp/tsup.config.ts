import { defineConfig } from "tsup";

export default defineConfig({
  // `index` is the stdio bin (has a shebang); `server` is the importable API.
  // The browser session now lives in @real-a11y-dev/browser (imported by both
  // the CLI and this server), so it is no longer built or re-exported here.
  entry: ["src/index.ts", "src/server.ts"],
  format: ["esm"],
  // `resolve` is what makes the private-package bundling below actually work
  // for TYPES. Bundling the JS is only half of it: without this, tsup emits
  // `export { SessionInfo } from "@real-a11y-dev/session-registry"` into
  // `server.d.ts` — a module npm cannot resolve, because it is never published.
  // Naming the package here inlines its declaration text instead, so the
  // published `.d.ts` has no reference to it at all.
  dts: {
    resolve: [
      "@real-a11y-dev/session-registry",
      // `server.d.ts` also REFERENCES `Finding` (audit) and `SnapshotPage`
      // (snapshot) structurally — `renderAudit(findings: Finding[])` and friends —
      // without re-exporting either. A structural reference is enough to emit
      // `from "@real-a11y-dev/audit"`, which is the trap: checking `index.ts` for
      // `export … from` statements, finding none, and skipping `dts.resolve` ships
      // an unresolvable specifier. The rule is "does any emitted declaration NAME
      // it", not "do we re-export it".
      "@real-a11y-dev/audit",
      "@real-a11y-dev/snapshot",
      "@real-a11y-dev/serialize",
      // mcp genuinely RE-EXPORTS these (server.d.ts line 3:
      // `export { A11ySession, BrowserSession, ... } from "@real-a11y-dev/browser"`),
      // so with browser private this is the published home for that API.
      "@real-a11y-dev/browser",
    ],
  },
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
  noExternal: [
    "@real-a11y-dev/session-registry",
    "@real-a11y-dev/audit",
    "@real-a11y-dev/serialize",
    "@real-a11y-dev/snapshot",
    "@real-a11y-dev/browser",
  ],
  banner: { js: "" },
});
