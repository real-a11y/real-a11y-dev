import { fingerprintFindings } from "./fingerprint.js";
import { redactUrl, type CleanSnapshot } from "./sanitize.js";
import type { SnapshotPage } from "./snapshot-artifact.js";

export interface BuildSnapshotPageOptions {
  /** Audit root selector recorded on the page. Defaults to `"body"`. */
  root?: string;
  /** Repo-relative source file for this page (the SARIF anchor). */
  sourcePath?: string;
}

/**
 * Assemble a diffable {@link SnapshotPage} from an already-projected snapshot.
 *
 * This is the single assembler both the CLI (`real-a11y snapshot`) and the MCP
 * server (`save_checkpoint`) call, so a snapshot captured by one and diffed by
 * the other carries **identical fingerprints**. It fingerprints the findings
 * under `name` (the stable join key, never the URL), redacts the URL, and
 * renames the raw `tabOrder` field to the artifact's `tabs`.
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
  return {
    name,
    url: redactUrl(url),
    root: options.root ?? "body",
    ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
    status: "ok",
    findings: fingerprintFindings(name, snapshot.findings),
    tree: snapshot.tree,
    outline: snapshot.outline,
    tabs: snapshot.tabOrder,
  };
}
