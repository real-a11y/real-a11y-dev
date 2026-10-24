---
id: R43
suite: regression
scenario: "Packed MCP tarball via npx — Playwright installs with it, and the documented launch drives a browser on a clean machine"
area: Packaging
type: Automated
priority: P0
status: Active
validFrom: "mcp ≥ 0.1.0-beta.10"
validUntil: ""
expected: "npx runs the packed MCP tarball from an empty directory with a fresh npm cache and NODE_PATH unset: Playwright lands beside the server and open_page opens a local page. With --legacy-peer-deps it doesn't, and open_page answers with the launch that installs it"
twin: D4
covers:
  - packages.@real-a11y-dev/mcp
  - mcp.tools.open_page
---

## Steps

Run the packed MCP tarball the way a client runs the published one: through npx, from an
empty directory, with nothing else that could make Playwright resolvable. The agent
container sets `NODE_PATH` to a directory holding a global Playwright, and `createRequire`
honours it, so unset it. A fresh npm cache keeps an earlier run's install out of the
result.

```bash
pnpm --filter "@real-a11y-dev/mcp..." build
(cd packages/mcp && pnpm pack --pack-destination /tmp/mcp-pack)
```

Serve a local page on `http://localhost:<port>/`. Any MCP stdio client will do; a short
script that sends `initialize`, then each `tools/call`, is enough. Point
`REAL_A11Y_CHROME_PATH` at a Chrome, or run `npx -y @real-a11y-dev/cli install` first.

1. From an empty directory, start the server with
   `env -u NODE_PATH npm_config_cache=$(mktemp -d) npx -y -p /tmp/mcp-pack/real-a11y-dev-mcp-*.tgz real-a11y-mcp`,
   then call `open_page http://localhost:<port>/` and `audit_page`
2. List what npx installed: `ls <that cache>/_npx/*/node_modules`
3. Once more with `npm_config_legacy_peer_deps=true` and another fresh cache, then
   `open_page` again

## Expected

- **1** — `open_page` opens the page and `audit_page` audits it
- **2** — `playwright` and `playwright-core` sit beside `@real-a11y-dev` in the npx
  install: npm installed the peer with the server
- **3** — with peers turned off, `open_page` is a tool error that names the fix:
  `npx -y -p @real-a11y-dev/mcp -p playwright real-a11y-mcp`, or `playwright` next to the
  server in a project. A bare `Cannot find package 'playwright'` with nothing after it
  is a fail

## Why this exists

Through mcp 0.1.0-beta.9 Playwright was an optional peer, and npm never installs an
optional peer, npx included. So the launch every doc gives, `npx -y @real-a11y-dev/mcp`,
started a server that answered `tools/list` and then failed its first browser tool with
`Cannot find package 'playwright'`. Nothing caught it. R8 and R9 run the server from the
workspace, where Playwright is a devDependency. D4 ran in the agent container, whose
`NODE_PATH` supplied a global Playwright. This row runs the packed tarball the way a
client would, without that crutch, before anything is published.
