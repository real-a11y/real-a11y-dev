/**
 * Page identity — the join key for diffs, baselines and fingerprints.
 *
 * Separate from the display label on purpose. `name` used to be both, and one
 * field doing two jobs is what made every rename a silent identity change: a
 * baseline recorded against `http://localhost:3000` stopped suppressing the
 * moment a config called that page `Home`, and two artifacts of the same route
 * captured under different labels classified as added + removed rather than
 * being compared.
 *
 * Neither of the obvious single fields works. The URL fails across
 * environments, which is why `name` was chosen over it in the first place —
 * *"never the URL (host/port legitimately differ)"*. The name fails across a
 * rename. So identity is derived from the part of the URL that survives both:
 * **everything after the origin**.
 *
 * That rule is not invented here. `differentUrl` already compares path + search
 * + hash and ignores the origin when deciding whether a checkpoint diff spans
 * two pages — prod-vs-preview is one page. This is the same rule promoted from
 * a warning to the identity it was always implying, and both now read it from
 * this module so a second definition can't drift into existence.
 */

/**
 * Schemes whose path is a **route** — a location the page can be re-fetched
 * from, and therefore something two captures can be joined on.
 *
 * Everything else has an *opaque* path: for `data:` it is the document itself,
 * for `about:` a keyword, for `blob:`/`javascript:` neither. Deriving an id
 * from those is actively wrong in both directions — two captures of one page
 * get different ids whenever the content differs by a byte (so they never
 * join), and the whole document body is copied into the artifact, every
 * fingerprint tuple and the committed baseline on the way past.
 */
const ROUTED_PROTOCOLS = new Set(["http:", "https:", "file:"]);

/**
 * The identity of the page at `url` — path + search + hash, no origin.
 *
 * **Pass the redacted url.** The id is written to the artifact, into every
 * finding's fingerprint tuple and into the committed baseline, all of which are
 * posted into PR comments — so it has to sit on the same side of the redaction
 * boundary as `page.url`, or `?token=…` reaches exactly the places `redactUrl`
 * exists to keep it out of. Redaction rewrites only *values*, never the path or
 * the parameter names, so the id it yields is just as stable a join key.
 *
 * Returns `undefined` when `url` is not a parseable absolute URL, **or** when
 * its scheme has no route to speak of (see {@link ROUTED_PROTOCOLS}). A caller
 * must handle that rather than paper over it: an address with no route cannot
 * be given an identity, and inventing one would silently join two unrelated
 * pages. `buildSnapshotPage` falls back to the display label there, which is
 * the pre-identity behaviour and remains right for content-addressed inputs.
 *
 * A single trailing slash is stripped so `/pricing` and `/pricing/` are one
 * page; the root stays `/`. Search is **included** — `/search?q=cats` and
 * `?q=dogs` render different content, so they are different pages. A URL
 * carrying tracking parameters is therefore its own page unless given an
 * explicit id, which is the accepted cost of having one rule instead of an
 * always-incomplete allowlist of parameters to ignore.
 */
export function pageIdOf(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (!ROUTED_PROTOCOLS.has(u.protocol)) return undefined;
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/$/, "") : "/";
  return `${path}${u.search}${u.hash}`;
}

/**
 * Qualify a page id with the subtree that was audited.
 *
 * **Only the artifact read path needs this.** Every producer captures
 * whole-document today and records `root: "body"` as a literal, so a fresh
 * capture has no subtree variation to encode. But an artifact written back when
 * `rootSelector` still narrowed a run can hold two pages at one URL with
 * different roots and genuinely different findings — and those carry no `id`,
 * so the back-fill would collapse them into one and the read would hard-error
 * on a file that is perfectly coherent. Qualifying by the recorded root keeps
 * it readable.
 *
 * The default root contributes nothing, so an ordinary page's id stays the bare
 * path and every id derived before this existed still matches.
 */
export function scopeId(id: string, root: string | undefined): string {
  return root === undefined || root === DEFAULT_ROOT ? id : `${id}#⟨${root}⟩`;
}

/** The whole-document root — the one that leaves an id unqualified. */
export const DEFAULT_ROOT = "body";
