---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Behind a proxy, a bypass list that names loopback now keeps it off the proxy on every Playwright the peer range admits.

On Playwright 1.49 to 1.58.2, localhost, 127.0.0.1 and the other loopback hosts went through the proxy even when the bypass list named them. For the CLI, that is `HTTPS_PROXY` with a `NO_PROXY` naming them: an audit of a local server failed with `net::ERR_PROXY_CONNECTION_FAILED` behind a dead proxy, and behind a live one, audited the proxy's error page as the page. A list that names a loopback host now bypasses every loopback host on those versions, as it does from Playwright 1.59. The fix is in `BrowserSession`, so code that embeds it from `@real-a11y-dev/mcp` with a `proxy.bypass` gets it too.

It counts more spellings as loopback than Playwright does: any case, the rest of 127/8, with or without a prefix length, `::1/128`, `.localhost` and `*.localhost`. `*` counts too, since it bypasses every host: Playwright sent loopback through the proxy even then, on every version. A list naming no loopback host is passed on as before, and loopback still goes through the proxy then, as Playwright has always done.
