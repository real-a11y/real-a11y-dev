import { fingerprintFindings } from "./fingerprint.js";
import { DEFAULT_ROOT, pageIdOf } from "./page-id.js";
import { redactUrl, type CleanSnapshot } from "./sanitize.js";
import type { SnapshotPage } from "./snapshot-artifact.js";

export interface BuildSnapshotPageOptions {
  /**
   * The page's identity — the diff/baseline/fingerprint join key.
   *
   * Defaults to `pageIdOf(url)`, which is what every caller wants; pass one
   * explicitly only to collapse or separate routes the path can't distinguish
   * (a query-parameterised page, say). Falls back to `name` when the url won't
   * parse, because a page still needs *an* identity and the label is the only
   * thing left — that is the pre-identity behaviour, kept for exactly the
   * inputs that used to rely on it.
   */
  id?: string;
  /** Audit root selector recorded on the page. Defaults to `"body"`. */
  root?: string;
  /** Repo-relative source file for this page (the SARIF anchor). */
  sourcePath?: string;
  /**
   * Did this run measure tab order? Native producers don't, and the page must
   * then omit `tabs` entirely rather than carry `""` — an empty view diffs as
   * "every stop removed", a "not measured" one is skipped. Defaults to true;
   * the artifact's `meta.views` has to agree (see `buildArtifact`).
   */
  tabOrder?: boolean;
}

/**
 * Assemble a diffable {@link SnapshotPage} from an already-projected snapshot.
 *
 * This is the single assembler both the CLI (`real-a11y snapshot`) and the MCP
 * server (`checkpoint_findings`) call, so a snapshot captured by one and diffed by
 * the other carries **identical fingerprints**. It fingerprints the findings
 * under the page's **id** — its identity, derived from the URL's path, not its
 * display label — redacts the URL, and
 * renames the raw `tabOrder` field to the artifact's `tabs` — or omits it, when
 * the producer never measured one (`options.tabOrder: false`).
 *
 * `snapshot` must already be sanitized with {@link projectSnapshot} — sanitize
 * before fingerprinting, or the two tools' fingerprints diverge (the cross-tool
 * golden test guards exactly this).
 */
export function buildSnapshotPage(
  name: string,
  url: string,
  snapshot: CleanSnapshot,
  options: BuildSnapshotPageOptions = {},
): SnapshotPage {
  // Identity, then the label. Fingerprints key on the id, so a page renamed for
  // display keeps every finding's identity — which is the whole point of the
  // two being separate fields.
  //
  // Derived from the REDACTED url, never the raw one: the id is written to the
  // artifact, every fingerprint tuple and the committed baseline, so a raw
  // `?token=…` here would route straight around `redactUrl` into the files this
  // tool posts into PR comments. It also keeps the id on the same footing as
  // `page.url` and `differentUrl`, which both read the redacted address — one
  // input, one definition of "same page".
  const safeUrl = redactUrl(url);
  // Not qualified by `root`: every producer captures whole-document and records
  // `"body"` verbatim, so there is no subtree variation left to encode. (The
  // parse path still qualifies, because an artifact written back when
  // `rootSelector` DID narrow a run carries a real root and two genuinely
  // different pages at one URL.)
  const id = options.id ?? pageIdOf(safeUrl) ?? name;
  return {
    id,
    name,
    url: safeUrl,
    root: options.root ?? DEFAULT_ROOT,
    ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
    status: "ok",
    findings: fingerprintFindings(id, snapshot.findings),
    tree: snapshot.tree,
    outline: snapshot.outline,
    ...(options.tabOrder === false ? {} : { tabs: snapshot.tabOrder }),
  };
}
