/**
 * A row's key states (`isKeyState`) as a screen reader hears them: in the
 * row's head, right after its name, in a visually hidden span. The badges a
 * sighted user sees follow the label instead (tree.css, "Long labels") and
 * are hidden from assistive technology, since a row's name comes from its
 * content, which would otherwise make them the last thing it says. Every
 * renderer that shows key states after the label pairs them with this.
 */
export function KeyStatesForReaders({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return <span class="sn-sr-only">{labels.join(", ")}</span>;
}
