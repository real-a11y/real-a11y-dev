---
id: R29
suite: regression
scenario: "CLI `session` lifecycle — list, stop, and stop-all daemon sessions"
area: CLI
type: Automated
priority: P1
status: Active
validFrom: "cli ≥ 0.1.0-beta.2"
validUntil: ""
expected: "A `tree --session` run leaves a daemon; `session list` reports it; `session stop` removes it; `session stop-all` removes all remaining."
covers:
  - cli.commands.session
---

## Steps

1. Build the CLI (`pnpm build` in `packages/cli`).
2. Run `real-a11y session stop-all` to clear any prior sessions.
3. Start a session with `real-a11y tree <fixture> --session lifecycle-test --allow-file --format json`.
4. Run `real-a11y session list --format json`.
5. Run `real-a11y session stop lifecycle-test --format json` (inapplicable flag).
6. Run `real-a11y session stop lifecycle-test`.
7. Run `real-a11y session list --format json` again.
8. Run `real-a11y session stop-all`.

## Expected

- **3** — exits `0` and prints the fixture's tree.
- **4** — JSON envelope `{ schemaVersion: 1, command: "session list", sessions: [...] }` contains one entry with `name` `lifecycle-test`, `status` `running`, and a `url`.
- **5** — exits non-zero with `--format applies to \`session list\`, not \`session stop\`` (the stop subcommands reject output flags instead of ignoring them); the session is still running.
- **6** — exits `0` and the session is gone.
- **7** — JSON envelope's `sessions` array is empty (or contains no `lifecycle-test` entry).
- **8** — exits `0`; a final `session list` is empty.

## Why this exists

`--session` spawns a background daemon; users need a way to see and terminate it.
This confirms the lifecycle surface advertised by `real-a11y session --help` works
and does not leak stale pidfiles/sockets.
