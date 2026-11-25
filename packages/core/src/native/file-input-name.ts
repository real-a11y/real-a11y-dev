import {
  winningNameSource,
  withholdFieldInternals,
  type FieldHostOf,
  type RawAXNameNode,
} from "./value-regions.js";

/**
 * Chromium names an unlabeled `<input type="file">` from its own button text
 * ("Choose File", "Choose Files" with `multiple`), localized. That text is
 * the browser's, not the page's: HTML-AAM gives the input no name, and the DOM
 * producer reads it as `""`. Left in the native tree it hides the input from
 * `no-unlabeled-interactive`, and strict mode prints it as `[redacted]`.
 *
 * Chromium's name trace says where the name came from. The winning step of
 * the built-in one is `type: "contents"` with `attribute: "value"`; an
 * author's name (`aria-label`, a `<label>`, `aria-labelledby`) wins with
 * another step, and so do submit, reset and image inputs' default names. This
 * detects the step, not the text, so it needs no knowledge of the locale.
 *
 * A node with no trace keeps its name: nothing says where it came from. The
 * rest of the trace stays, because labels are read from it; only the winning
 * step's text is emptied, so no step is left for `winningNameSource` to
 * return. Returns copies; never mutates.
 *
 * Run it before the strict-mode passes, which overwrite the name and drop
 * the trace, and before the raw index is built.
 */
export function dropBuiltInFileInputNames<T extends RawAXNameNode>(
  rawNodes: T[],
): T[] {
  let changed = false;
  const out = rawNodes.map((raw) => {
    const winner = winningNameSource(raw);
    if (winner?.type !== "contents" || winner.attribute !== "value") return raw;
    changed = true;
    const sources = raw.name?.sources?.map((step) =>
      step === winner ? { ...step, value: { ...step.value, value: "" } } : step,
    );
    return { ...raw, name: { ...raw.name, value: "", sources } };
  });
  return changed ? out : rawNodes;
}

/**
 * The text the browser itself puts on a form control, taken off the raw nodes
 * before anything reads a name: what the control draws inside itself
 * ({@link withholdFieldInternals}) and a file input's built-in name
 * ({@link dropBuiltInFileInputNames}). For a transport that has no earlier
 * step of its own to hang the second on.
 */
export function withholdBrowserText<T extends RawAXNameNode>(
  rawNodes: T[],
  hostOf: FieldHostOf | undefined,
): T[] {
  return dropBuiltInFileInputNames(withholdFieldInternals(rawNodes, hostOf));
}
