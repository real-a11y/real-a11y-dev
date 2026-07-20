// Typographic normalization for accessible-name COMPARISON.
//
// The same human-readable text has several byte representations. Design tools
// (Figma), word processors, and CMSes auto-apply "smart" typography, so their
// text carries curly quotes, ellipsis characters, en/em dashes, and
// non-breaking spaces -- while a developer hand-typing an expected name uses the
// plain ASCII forms. Byte-for-byte they differ; to a reader (and a screen
// reader) they're the same string. When one side of a comparison is
// human-authored (a `ChangeSpec` name, a `toHaveTabSequence` token) and the
// other is extracted from the live DOM, that mismatch is a confusing false
// failure: two names that look pixel-identical don't match.
//
// This folds those variants so name MATCHING is robust to typography. It is used
// only at comparison time -- never on serialized output, which stays faithful to
// what assistive tech actually announces (a screen reader really does read the
// curly-quote text; folding it into the committed snapshot would hide real
// content and churn every baseline).
//
// Deliberately CONSERVATIVE. It folds only characters that tools routinely swap
// for one another and that carry no intended semantic difference in a name:
//
//   - curly single quotes / apostrophes  U+2018-201B  ->  '
//   - curly double quotes                U+201C-201F  ->  "
//   - ellipsis                           U+2026       ->  ...
//   - en / em / horizontal-bar dashes    U+2013-2015  ->  -
//   - non-breaking space                 U+00A0       ->  space
//   - Unicode NFC (compose accents: e + combining-acute -> composed e-acute)
//
// It does NOT use NFKC (which would also fold ligatures, superscripts, and
// full-width forms -- too lossy: superscript-2 -> "2", the fi ligature -> "fi"),
// and does not touch guillemets, primes, or the math minus sign, whose
// difference can be intentional. Everything folded is documented so a match that
// only succeeds after folding is never mysterious.

/** Fold typographic variants to ASCII so accessible-name matching ignores
 *  smart-quote / dash / NBSP differences between authored and extracted text. */
export function foldTypography(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/…/g, "...")
    .replace(/[–—―]/g, "-")
    .replace(new RegExp(String.fromCharCode(0xa0), "g"), " ");
}
