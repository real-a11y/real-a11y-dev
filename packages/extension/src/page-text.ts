import { isHiddenFromAT } from "@real-a11y-dev/core";

/**
 * Form controls whose child text is not what they show: a `<textarea>`'s is
 * its markup DEFAULT value — stale once the user types, and for a sensitive
 * field (ADR-0001) the secret itself — a `<select>`'s is every option, not
 * the chosen one, and a `<datalist>`'s are suggestions. Core's field-text
 * walk skips the same set. Each control carries its own value, which a text
 * read never reaches.
 */
const CONTROL_TEXT_TAGS: ReadonlySet<string> = new Set([
  "select",
  "textarea",
  "datalist",
]);

// Captured once: a `<form>` whose control is named `ownerDocument` shadows the
// property, and an `<img name="createTreeWalker">` shadows the document's.
const ownerDocumentGetter = Object.getOwnPropertyDescriptor(
  Node.prototype,
  "ownerDocument",
)?.get;
const createTreeWalker = Document.prototype.createTreeWalker;

/**
 * Core's `isHiddenFromAT`, read as "not hidden" when it throws — a `<form>`
 * whose control shadows `tagName` makes it — so a hostile form costs a read
 * no text it shows.
 */
function hiddenFromAT(element: Element): boolean {
  try {
    return isHiddenFromAT(element);
  } catch {
    return false;
  }
}

/**
 * `root`'s text the way `textContent` reads it, less the text the page never
 * shows as text: a control's children ({@link CONTROL_TEXT_TAGS}), `root`
 * included. With `skipHidden`, also every subtree hidden from assistive
 * technology, `root` included — `aria-hidden`, `hidden`, `inert`,
 * `display: none`, `visibility: hidden`, `<script>` and `<style>` — so the
 * result is what a screen reader could announce.
 *
 * Walks with a `TreeWalker`, which reads the tree natively: a `<form>` whose
 * control is named `childNodes` can't misdirect it.
 */
export function pageText(
  root: Element,
  { skipHidden = false }: { skipHidden?: boolean } = {},
): string {
  // `localName` can't throw: only a <form> shadows it, and no form is a control.
  if (CONTROL_TEXT_TAGS.has(root.localName)) return "";
  if (skipHidden && hiddenFromAT(root)) return "";

  const doc = (ownerDocumentGetter?.call(root) as Document | null) ?? document;
  const walker = createTreeWalker.call(
    doc,
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        const el = node as Element;
        const unread =
          CONTROL_TEXT_TAGS.has(el.localName) ||
          (skipHidden && hiddenFromAT(el));
        // REJECT drops the whole subtree; SKIP walks on into it.
        return unread ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      },
    },
  );
  let text = "";
  while (walker.nextNode()) text += (walker.currentNode as Text).data;
  return text;
}
