---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

fix: redact secrets in a URL's **fragment**, and stop `open_page` printing its landing URL raw.

Every URL these tools print goes through one redactor, which stripped userinfo and replaced secret-looking **query** parameters. It never looked past the `#`. That is precisely where OAuth's implicit flow puts its tokens — a redirect lands on `…/callback#access_token=ya29.…&token_type=bearer` — and because a fragment is never sent to the server, it is _only_ ever visible client-side, which is where this toolchain reads it. So a token in the query was redacted and the same token in the fragment was printed in full, into agent context, CLI output, saved artifacts, reports and CI logs.

Ordinary fragments are left exactly as they were: `#installation` and `#/dashboard/users` are useful and are not secrets. Pairs are rewritten **in place**, so only a matched value changes and every other byte — separators, existing encoding, a bare trailing `#` — survives as it arrived.

A fragment is opaque to the URL parser, so nothing decides authoritatively how it splits — the _app_ does. `#`, `?`, `&`, `/`, `;` and `,` are all treated as separators, and the assignment may be `=` or `%3D`. That covers the shape this is most likely to meet in the wild (a hash-routed SPA completing an implicit flow lands on `…/#/callback#access_token=…`, where the second `#` separates in every sense except the parser's) and Angular Router's matrix parameters, which use `;` inside the fragment.

Anything that still cannot be read as pairs, yet plainly carries a secret-shaped key, is truncated from the last separator before it — **the route in front of it is kept**. That matters beyond readability: page identity is derived from the redacted URL, and for a hash-routed SPA every route lives at pathname `/`, so discarding the whole fragment collapsed distinct pages onto one id.

Separately, the MCP `open_page` result printed `Opened <url>` unredacted, and the page-controlled `Title:` beside it unsanitized — a page could set `document.title` to inject a terminal escape sequence and forge extra result lines, including a second `Opened <url>` an agent cannot distinguish from the real one. Both now go through the boundary.

On the URL half: It matters more than it looks: the URL it prints is where the page **landed**, so it is the end of a redirect chain, and an OAuth redirect chain ends with the token. The matching failure path leaked it too — Playwright quotes the full target URL in a navigation error, and that message is relayed to the agent verbatim — so escaping errors now go through the same redactor the CLI already applied to its equivalent path.

## One caveat worth knowing

A page's identity is derived from its redacted URL, fragment included. A stored baseline or checkpoint whose fragment contains a deny-listed key — `#…code=…`, `#…token=…`, `#…key=…`, including as a _route_ segment like `#/orders/code=US` — therefore gets a new identity and will not join against a fresh capture. Re-baseline it. Note that `code` and `key` are ordinary route words, so this reaches some URLs that never carried a secret; a page that re-keys silently reports its whole committed baseline as new findings, which is the failure worth watching for.

An ordinary `#anchor` is byte-identical to before and joins as it always did. And the flip side is the point: an artifact whose fragment held a real token was previously storing that token on disk, which is the worse half of this bug.
