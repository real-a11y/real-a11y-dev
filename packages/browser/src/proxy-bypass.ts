/**
 * The proxy bypass list a launched Chromium gets, normalised so that a list
 * naming loopback keeps it off the proxy on every Playwright the peer range
 * admits.
 *
 * Playwright passes `bypass` to Chromium as `--proxy-bypass-list`, where a
 * later rule overrides an earlier one. Up to 1.58.2 it appended `<-loopback>`
 * to any list without one, which takes Chromium's implicit loopback bypass
 * away, so `localhost` in the list still went to the proxy: to a dead proxy
 * that is a failed navigation, to a live one, its error page loaded as the
 * page. From 1.59 it leaves the implicit bypass alone when the list names a
 * loopback host, which is what the list's author meant all along.
 */

/**
 * Chromium's implicit bypass rules: loopback and link-local hosts skip any
 * proxy unless a `<-loopback>` rule takes them away.
 */
const IMPLICIT_BYPASS_RULES = [
  "localhost",
  "*.localhost",
  "127.0.0.1/8",
  "[::1]",
  "169.254.0.0/16",
  "fe80::/10",
];

/**
 * Whether one entry of a bypass list names loopback. Playwright 1.59 counts
 * only its exact spellings (`localhost`, `127.0.0.1`, `::1`, `[::]`, `[::1]`,
 * `<loopback>`); this also takes any case, which Chromium's hostname matching
 * does, the rest of 127/8 with or without a prefix length, `::1` with one,
 * and `*.localhost`. And `*`, which bypasses every host: Playwright does not
 * count it, so a list bypassing every host still sent loopback to the proxy,
 * which no one writing `NO_PROXY=*` means.
 */
function namesLoopback(entry: string): boolean {
  const host = entry.toLowerCase();
  if (
    host === "*" ||
    host === "localhost" ||
    host === ".localhost" ||
    host === "*.localhost" ||
    host === "[::]" ||
    host === "<loopback>"
  ) {
    return true;
  }
  if (/^127(\.\d{1,3}){3}(\/\d{1,2})?$/.test(host)) return true;
  return /^(\[::1\]|::1)(\/128)?$/.test(host);
}

/**
 * A bypass list that names loopback, led by `<-loopback>`, which stops
 * Playwright up to 1.58.2 appending its own, and then the implicit rules that
 * takes away: every version then bypasses what 1.59 does. A list naming no
 * loopback host, or holding `<-loopback>` already, is returned as it is:
 * there every version already agrees, loopback through the proxy.
 */
export function loopbackSafeBypass(
  bypass: string | undefined,
): string | undefined {
  if (!bypass) return bypass;
  const entries = bypass.split(",").map((entry) => entry.trim());
  if (entries.includes("<-loopback>")) return bypass;
  if (!entries.some(namesLoopback)) return bypass;
  return ["<-loopback>", ...IMPLICIT_BYPASS_RULES, bypass].join(",");
}

/**
 * A launch proxy with its bypass list made loopback-safe, or the proxy itself
 * when there is nothing to change.
 */
export function withLoopbackBypass<
  P extends { server: string; bypass?: string },
>(proxy: P): P {
  const bypass = loopbackSafeBypass(proxy.bypass);
  return bypass === proxy.bypass ? proxy : { ...proxy, bypass };
}
