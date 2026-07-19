/**
 * A snapshot artifact or baseline file is malformed — not valid JSON, the
 * wrong shape, or a version the reader can't accept.
 *
 * This is a *domain* error: the engine knows nothing about processes or exit
 * codes. It carries an optional `hint` (a suggested remedy) so the consuming
 * surface can present both without re-deriving it — the CLI, for instance,
 * renders `real-a11y: error: <message>` plus the hint and exits 2.
 */
export class SnapshotFormatError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "SnapshotFormatError";
  }
}
