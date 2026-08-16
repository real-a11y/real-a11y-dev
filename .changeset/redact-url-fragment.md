---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

fix: redact secrets in a URL's **fragment**, and stop `open_page` printing its landing URL raw.

Every URL these tools print goes through one redactor, which stripped userinfo and replaced secret-looking **query** parameters. It never looked past the `#`. That is precisely where OAuth's implicit flow puts its tokens — a redirect lands on `…/callback#access_token=ya29.…&token_type=bearer` — and because a fragment is never sent to the server, it is _only_ ever visible client-side, which is where this toolchain reads it. So a token in the query was redacted and the same token in the fragment was printed in full, into agent context, CLI output, saved artifacts, reports and CI logs.

Ordinary fragments are left exactly as they were: `#installation` and `#/dashboard/users` are useful and are not secrets. Pairs are rewritten **in place**, so only a matched value changes and every other byte — separators, existing encoding, a bare trailing `#` — survives as it arrived.

A fragment is opaque to the URL parser, so nothing decides authoritatively how it splits: `#`, `?` and `&` are all treated as separators. That matters for the shape this is most likely to meet in the wild — a hash-routed SPA completing an implicit flow lands on `…/#/callback#access_token=…`, where the second `#` separates in every sense except the parser's. Anything that still cannot be read as pairs, yet plainly carries a secret-shaped key (a percent-encoded `=`, say), drops the **whole fragment** rather than printing it: where this code and the app that wrote the URL disagree about where it splits, the safe answer is to print none of it.

Separately, the MCP `open_page` result printed `Opened <url>` unredacted. It matters more than it looks: the URL it prints is where the page **landed**, so it is the end of a redirect chain, and an OAuth redirect chain ends with the token. The matching failure path leaked it too — Playwright quotes the full target URL in a navigation error, and that message is relayed to the agent verbatim — so escaping errors now go through the same redactor the CLI already applied to its equivalent path.

## One caveat worth knowing

A page's identity is derived from its redacted URL, fragment included. A stored baseline or checkpoint whose fragment carried a secret-looking key (`#…code=…`, `#…token=…`) therefore gets a new identity and will not join against a fresh capture — re-baseline it. Only URLs with those keys in the fragment are affected; an ordinary `#anchor` is byte-identical to before and joins as it always did. Note the flip side: an artifact like that was previously storing the secret on disk, which is the worse half of this bug.
