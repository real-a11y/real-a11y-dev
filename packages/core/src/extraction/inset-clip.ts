/**
 * Reading `clip-path: inset(...)` for the visually-hidden idiom. Pure string
 * parsing, no DOM access.
 */

/**
 * How far an `inset()` component moves its edge in, as a percentage of the
 * box, or `NaN` when this walk cannot know. Only a percentage proves a
 * distance without the box's size — plus a zero, which is zero in any unit.
 * A length or a `calc()` is unmeasurable, and every comparison against `NaN`
 * is false, so an unreadable component never answers "collapsed".
 */
function insetEdge(value: string): number {
  const amount = parseFloat(value);
  return amount === 0 || value.endsWith("%") ? amount : NaN;
}

/**
 * Does an `inset()` component push its edge outward rather than in?
 *
 * A component this cannot read is taken as inward. Dropping the 100%
 * shortcut below for every unreadable far edge would cost the common
 * `inset(100% 0 10px 0)`, and a negative inset is a rarity beside it.
 */
function insetEdgeGrows(value: string): boolean {
  return parseFloat(value) < 0;
}

/** Do two opposing `inset()` edges leave nothing between them? */
function insetEdgesCollapse(near: string, far: string): boolean {
  const a = insetEdge(near);
  const b = insetEdge(far);
  // A single inset of 100% crosses the whole box — but only when the edge
  // opposite it is not pushed back out. A negative inset grows the shape, so
  // `inset(100% 0 -50% 0)` clips to a strip below the box rather than to
  // nothing, and content overflowing into it is still painted. Short of that
  // shortcut the pair has to meet, which accounts for a negative already.
  return (
    (a >= 100 && !insetEdgeGrows(far)) ||
    (b >= 100 && !insetEdgeGrows(near)) ||
    a + b >= 100
  );
}

/**
 * The components of the `inset()` in a `clip-path`, 1 to 4 of them as
 * written, or `null` if there is no readable one.
 *
 * A reference box may sit either side of the shape (`inset(50%) margin-box`),
 * so the shape is read out of the middle of the value. Parentheses are
 * tracked in the one pass that splits the components, so a nested
 * `calc(50% + 1px)` stays a single component instead of being cut at its own
 * `)` and shifting every component after it onto the wrong edge.
 */
function insetComponents(clipPath: string): string[] | null {
  const open = clipPath.indexOf("inset(");
  if (open === -1) return null;

  const components: string[] = [];
  let component = "";
  // Inside the shape's own parenthesis already, so depth starts at 1 and the
  // `)` that takes it back to 0 ends the shape.
  let depth = 1;
  let closed = false;
  for (let i = open + "inset(".length; i < clipPath.length; i++) {
    const char = clipPath[i];
    if (char === "(") depth++;
    else if (char === ")") {
      if (--depth === 0) {
        closed = true;
        break;
      }
    } else if (depth === 1 && /\s/.test(char)) {
      if (component) components.push(component);
      component = "";
      continue;
    }
    component += char;
  }
  if (!closed) return null;
  if (component) components.push(component);

  // `round <border-radius>` rounds the corners of the same shape, so it says
  // nothing about whether that shape is empty.
  const round = components.indexOf("round");
  const shape = round === -1 ? components : components.slice(0, round);
  return shape.length === 0 || shape.length > 4 ? null : shape;
}

/**
 * Does a `clip-path: inset(...)` provably leave nothing painted?
 *
 * The visually-hidden idiom is `inset(50%)` or `inset(100%)`: insets that meet
 * or cross, so the box clips away to nothing. A length never proves that —
 * `inset(10px)` crops a decorative edge off an element that stays fully
 * visible, and matching it marked that element `dom.isHidden`.
 *
 * The box's own size is not read here, so a length could not be measured
 * against it, and the caller's `clip` branch (in `isSrOnly`) reads that size
 * only for `clip: rect()`. A length is deliberately not measured: the
 * 1px-box idiom that would need it pairs the box with `clip: rect(0, 0, 0,
 * 0)`, which that branch already catches, and a 1px box clipped only by
 * `clip-path: inset(1px)` is not an idiom anything uses. The cost is that
 * such a box reads visible.
 *
 * Only `inset()` is read. Another shape that collapses the box — `circle(0)`
 * — answers no, as does a `calc()` on an edge the answer depends on: unread
 * is safer here than guessed at, since a wrong yes hides something drawn.
 */
export function insetCollapsesBox(clipPath: string): boolean {
  const components = insetComponents(clipPath);
  if (!components) return false;
  // The CSS shorthand: one value is all four sides, two is vertical then
  // horizontal, three adds bottom, four is top/right/bottom/left.
  const [top, right = top, bottom = top, left = right] = components;
  return insetEdgesCollapse(top, bottom) || insetEdgesCollapse(left, right);
}
