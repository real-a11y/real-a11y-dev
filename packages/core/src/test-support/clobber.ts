/**
 * Test support for DOM clobbering. Imported only by `*.test.ts` files and not
 * reachable from `src/index.ts`, so it never lands in a bundle.
 */

/**
 * Shadow `prop` on `owner` with the element named `prop` inside it, as the two
 * interfaces with `[LegacyOverrideBuiltIns]` do: a `<form>` for its controls,
 * and the document for a named `<img>`, `<form>`, `<embed>` or `<object>`.
 * Forced, because jsdom's named-property override is not guaranteed. Returns
 * that element.
 *
 * The shadowed read is a tripwire: it throws instead of returning the element.
 * Code that reads it gets the element rather than the owner's own value, which
 * is the bug already — and a walk up the tree that reads a clobbered
 * `parentElement` or `parentNode` cycles between the owner and that element
 * forever, which no test timeout can stop. The throw turns the hang into a
 * failure that names the property.
 *
 * A `<form>` is rebuilt with each test's markup. The document is not, so a
 * test that clobbers it must `delete document[prop]` when it is done.
 */
export function clobber(owner: Element | Document, prop: string): Element {
  const named = owner.querySelector(`[name="${prop}"]`);
  if (!named) throw new Error(`nothing named "${prop}" to shadow it with`);
  const label = owner.nodeType === 9 ? "document" : "form";
  Object.defineProperty(owner, prop, {
    configurable: true,
    get: () => {
      throw new Error(
        `read ${label}.${prop}, which the element named "${prop}" shadows — a walk up the tree would cycle through it`,
      );
    },
  });
  return named;
}
