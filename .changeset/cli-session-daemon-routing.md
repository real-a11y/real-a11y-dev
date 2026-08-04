---
"@real-a11y-dev/cli": minor
---

Add `--session` routing so browser-driving CLI commands reuse the session daemon.

Any browser-driving command (`tree`, `outline`, `tabs`, `list`, `interact`, `click`, `type`, `focus`, `inspect`, `audit`) accepts `--session <name>`. The first such run spawns a detached daemon listening on a Unix domain socket under `~/.real-a11y/sessions/<name>/daemon.sock`; later runs with the same name connect to it and act on the same live page. Without `--session` the one-shot default is unchanged.

The session name resolves as explicit `--session` → `a11y.config.json` `defaults.session` → a stable hash of the current working directory. `snapshot` declares `--session` but is not yet routed to the daemon in this release.
