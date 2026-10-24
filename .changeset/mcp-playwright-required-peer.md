---
"@real-a11y-dev/mcp": patch
---

`npx -y @real-a11y-dev/mcp` now installs Playwright with the server, so its browser tools work on a machine with nothing else installed.

Playwright was an optional peer, and npm never installs an optional peer, npx included. So the documented launch started a server that answered `tools/list`, then failed its first browser tool with `Cannot find package 'playwright'`, unless something else on the machine made Playwright resolvable. It is now a required peer: npm installs it with the server, in a project too, and so does pnpm with its default `auto-install-peers`. Yarn, pnpm with that setting off, and a `--legacy-peer-deps` install still leave it out. There, a browser tool now answers with the fix instead of the bare module error: launch the server as `npx -y -p @real-a11y-dev/mcp -p playwright real-a11y-mcp`, or install `playwright` next to it.
