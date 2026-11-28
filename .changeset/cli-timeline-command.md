---
"@real-a11y-dev/cli": minor
---

New `real-a11y timeline start <url> --session <name>` / `timeline stop --session <name>`: record where focus goes and what live regions announce **between** commands on a session, in the order the page made them (the timeline view, ADR-0002). `stop` prints one line per event, `focus     button "New draft"` or `announce  status "Draft deleted."`, or with `--format json` the same events as data under `pages[0].events`, alongside `timeline` (the lines), `navigated`, and `end` (`stopped`, `navigated` or `closed`). `start` takes `--root` to scope what is recorded.

- It is the second command built from the in-page walk, after `tabs`, because that order exists only in the page. The recorder is injected into the page only while a timeline records. No producer header.
- A navigation ends the recording: `stop` prints the lines from before it, and a last line saying where the page went (`navigated: true` in JSON).
- `--redact-input` on `start` withholds a focused name or an announcement that would carry text typed into a rich-text editor. A `stop --redact-input` of a recording started without it prints nothing and exits 2, keeping the recording for a `stop` without the flag. `a11y.config.json` `redact` patterns apply to the lines and to the JSON events alike.
- `stop` on a session that isn't running exits 2 without launching a browser, and a config's `defaults.session` works for both subcommands.
- `tabs --help` and the `defaults.root` warning now name `timeline` beside `tabs` as the commands `--root` scopes.
