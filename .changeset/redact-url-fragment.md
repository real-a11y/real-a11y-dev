---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

fix: redact secrets in a URL's **fragment**, and stop `open_page` printing its landing URL raw.

Every URL these tools print goes through one redactor, which stripped userinfo and replaced secret-looking **query** parameters. It never looked past the `#`. That is precisely where OAuth's implicit flow puts its tokens — a redirect lands on `…/callback#access_token=ya29.…&token_type=bearer` — and because a fragment is never sent to the server, it is _only_ ever visible client-side, which is where this toolchain reads it. So a token in the query was redacted and the same token in the fragment was printed in full, into agent context, CLI output, saved artifacts, reports and CI logs.

Ordinary fragments are left exactly as they were: `#installation` and `#/dashboard/users` are useful and are not secrets, so only a fragment that actually parses as key/value pairs is rewritten, and only the keys already recognised as secret-bearing. A hash router carrying its own query (`#/cb?code=…`) is handled too. An untouched fragment is returned verbatim rather than re-serialized, so a plain anchor cannot pick up percent-encoding on the way through.

Separately, the MCP `open_page` result printed `Opened <url>` unredacted — the one place in that server which bypassed the redactor. It matters more than it looks: the URL it prints is where the page **landed**, so it is the end of a redirect chain, and an OAuth redirect chain ends with the token.

## One caveat worth knowing

A page's identity is derived from its redacted URL, fragment included. A stored baseline or checkpoint whose fragment carried a secret-looking key (`#…code=…`, `#…token=…`) therefore gets a new identity and will not join against a fresh capture — re-baseline it. Only URLs with those keys in the fragment are affected; an ordinary `#anchor` is byte-identical to before and joins as it always did. Note the flip side: an artifact like that was previously storing the secret on disk, which is the worse half of this bug.
