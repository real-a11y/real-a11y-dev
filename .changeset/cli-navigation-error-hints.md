---
"@real-a11y-dev/cli": patch
---

Name the failure when a page can't be opened, instead of always suggesting timeout flags.

Every failed navigation used to end with the same hint — `is the server running? Try --wait-until domcontentloaded or --timeout 60000.` That's advice for a page that loads too slowly, and it's wrong for the failures people actually hit: a hostname that doesn't resolve, or a port Chrome refuses outright. The exit code was right; the hint sent you to tune timeouts rather than fix the URL.

Chromium's `net::ERR_*` errors now get hints that say what happened: DNS failure, unsafe port, connection refused, an unreachable network or proxy, a rejected TLS certificate, a redirect loop, and a connection closed without a response. A genuine timeout — and anything unrecognised — still gets the `--wait-until` / `--timeout` advice.
