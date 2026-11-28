---
id: R50
suite: regression
scenario: "CLI `timeline start` / `stop` — focus moves and announcements between commands on a `--session`, kept across a navigation"
area: CLI
type: Automated
priority: P1
status: Active
validFrom: "cli ≥ 0.1.0-beta.15"
validUntil: ""
expected: "start prints nothing on stdout; a click between start and stop prints its announcements and focus moves in order, with no producer header; a link that navigates keeps the lines before it and ends with the navigation note (navigated: true in JSON); config redact patterns mask the lines and the JSON events; a strict stop of a lax start prints nothing and exits 2; no --session exits 2"
covers:
  - cli.commands.timeline
notion: "https://app.notion.com/p/4241c354b0b581ae8f5cec7446c08731"
---

## Steps

Build the CLI (`pnpm build`), then save as `drafts.html` beside a `next.html`
that holds `<main><h1>Next</h1></main>`:

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Drafts</title></head>
<body>
<main>
  <ul><li id="draft">Draft 1 <button id="del">Delete draft</button></li></ul>
  <button id="new">New draft</button>
  <a href="next.html">Next page</a>
  <p role="status" id="status"></p>
</main>
<script>
  document.getElementById("del").addEventListener("click", async () => {
    const status = document.getElementById("status");
    status.textContent = "Deleting…";
    await new Promise((r) => setTimeout(r, 20));
    document.getElementById("draft").remove();
    await new Promise((r) => setTimeout(r, 20));
    document.getElementById("new").focus();
    status.textContent = "Draft deleted.";
  });
</script>
</body></html>
```

With `U=file://$PWD/drafts.html` and `F="--session r50 --allow-file --no-config"`:

1. `real-a11y timeline start "$U" $F --root main`, then
   `real-a11y click "$U" $F --role button --name "Delete draft" -q`, then
   `real-a11y timeline stop $F`
2. `real-a11y timeline start "$U" $F --root main`,
   `real-a11y click "$U" $F --role link --name "Next page" -q`,
   `real-a11y timeline stop $F`
3. Step 2 again, with `--format json` on `stop`
4. Write `a11y.config.json` holding `{ "redact": ["Draft \\w+\\."] }` and run
   step 1 with `--config a11y.config.json` in place of `--no-config`, and
   `--format json` on `stop`
5. `real-a11y timeline start "$U" $F`, then `real-a11y timeline stop $F --redact-input`
6. `real-a11y timeline start "$U" --allow-file --no-config` (no `--session`)
7. `real-a11y session stop r50`, then `real-a11y timeline stop $F`

## Expected

- **1** — `start` exits `0` with an empty stdout (its progress line is on
  stderr). `stop` exits `0` and prints exactly:
  ```
  announce  status "Deleting…"
  focus     button "New draft"
  announce  status "Draft deleted."
  ```
  No producer header. There is no `focus button "Delete draft"` line: the
  CLI's `click` dispatches its events without moving focus to the button.
- **2** — the last line is
  `(a navigation ended the recording: the page moved to file://…/next.html, and the lines above came before it)`
- **3** — `pages[0].navigated` is `true`, `pages[0].end` is `"navigated"`,
  `pages[0].url` ends in `next.html`, and `pages[0].events` is an array
- **4** — neither the lines (`pages[0].timeline`) nor `pages[0].events` contain
  `Draft deleted.`; the announcement reads `[REDACTED]` in both
- **5** — exit `2`, empty stdout, stderr names `--redact-input was not set`;
  a `real-a11y timeline stop $F` after it still prints the recording
- **6** — exit `2`, stderr `timeline needs --session`
- **7** — the second command exits `2` with `no session "r50" is running`, and
  `real-a11y session list` shows no `r50`: nothing was launched to find that out

## Why this exists

Every other CLI view reads one moment. This is the only one that reads what
happened between two commands, so the order of its lines is its whole claim.
The recording lives in a page that outlives the command that started it, which
is new for the CLI: the lines leave the page as each block settles, so step 2
is the case that only works if they do. A recorder that handed its events over
only at `stop` would print nothing for it.

Step 4 guards the one path where text leaves without passing through a
serializer: the events carry page text from before the user's `redact`
patterns, so `--format json` must apply them itself.

## Notes

`timeline` is the second DOM holdout after `tabs` (ADR-0002): its names come
from this project's accessible-name computation, not Chromium's, so a focus
line can name an element differently from `tree`. Compare it to the `testing`
twin of the same flow, R49, not to `tree`.
