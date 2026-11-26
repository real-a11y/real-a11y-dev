import { parseTabindex } from "../extraction/focusability.js";
import { REDACTED_VALUE } from "../extraction/sensitivity.js";
import type { SemanticNode } from "../types.js";

import { linearize } from "./linearize.js";
import { nodesOf, type QueryInput } from "./types.js";

/**
 * Return the tab sequence of the tree — every focusable node in the order a
 * user would hit while pressing Tab:
 *
 *   1. `tabindex > 0` in ascending numeric order (ties broken by DOM order).
 *   2. `tabindex === 0` and naturally focusable elements, in DOM order.
 *
 * Nodes with a negative tabindex or `interaction.isFocusable === false` are
 * excluded. A disabled control is already unfocusable there. An
 * `aria-disabled` one is not, and stays a stop, as it does in Chromium.
 *
 * A stop that is one of the items a sensitive field's choice is made among
 * (`a11y.choiceWithheld`, ADR-0001) comes back as a copy whose name reads
 * `"[redacted]"`, with no description, value, text or naming attribute: singled out
 * as a stop, it
 * says which choice is made, since the one tab stop of a roving-tabindex list
 * box is its chosen option. The tree keeps its name, beside the others'.
 *
 * A frame is listed once, where Tab enters it: an `<iframe>`, or an `<object>`
 * showing a document. The walk does not read frame content, so one entry
 * stands for however many stops the frame holds. In a tree merged from
 * several frames (the extension's), the frame's own stops are already in place
 * under its `<iframe>` node, so the `<iframe>` is listed only when none lies
 * inside it. An approximation there: the inner stops do not follow the
 * frame's own `tabindex`.
 *
 * This is an approximation: it does not replicate the browser's sequential
 * focus navigation precisely (shadow roots, dialog focus traps, `<embed>`,
 * keyboard-focusable scrollers), but it is good enough for snapshot-based
 * tab-order audits on a document tree.
 */
export function getTabSequence(input: QueryInput): SemanticNode[] {
  const focusable: Array<{
    node: SemanticNode;
    tabindex: number;
    order: number;
  }> = [];
  let order = 0;
  const nodes = nodesOf(input);

  // Whether a stop of the sequence lies under `node`.
  const hasStopBelow = (node: SemanticNode): boolean =>
    node.childIds.some((id) => {
      const child = nodes.get(id);
      if (!child) return false;
      // A nested frame counts too: it is listed itself when it holds no stop,
      // and its stops are listed when it does.
      return isStop(child) || hasStopBelow(child);
    });

  for (const node of linearize(input)) {
    if (!isStop(node) || (isFrame(node) && hasStopBelow(node))) {
      order++;
      continue;
    }
    const ti = parseTabindex(node.dom?.attributes?.tabindex);
    focusable.push({ node, tabindex: ti ?? 0, order: order++ });
  }

  const positives = focusable
    .filter((f) => f.tabindex > 0)
    .sort((a, b) =>
      a.tabindex === b.tabindex ? a.order - b.order : a.tabindex - b.tabindex,
    );
  const zeros = focusable
    .filter((f) => f.tabindex <= 0)
    .sort((a, b) => a.order - b.order);

  return [...positives, ...zeros].map((f) => asStop(f.node));
}

/** An `<iframe>` node: the one a merged tree hangs a frame's content under. */
function isFrame(node: SemanticNode): boolean {
  return node.dom?.tagName === "iframe";
}

/**
 * Whether `node` is a tab stop of its own. A node with no `interaction` facet
 * (native read-only) is not known focusable, and a negative tabindex takes a
 * focusable node out of the sequence.
 */
function isStop(node: SemanticNode): boolean {
  if (!node.interaction?.isFocusable) return false;
  const ti = parseTabindex(node.dom?.attributes?.tabindex);
  return ti === null || ti >= 0;
}

/** `a11y` without its `value`, which can say the choice as its name does. */
function withoutValue(a11y: SemanticNode["a11y"]): SemanticNode["a11y"] {
  const { value: _value, ...rest } = a11y;
  return rest;
}

/** The attributes a withheld stop keeps: what places it, none that names it. */
const STOP_ATTRIBUTES = ["tabindex", "role", "type"] as const;

/**
 * `node` as the tab order shows it: where it says a choice, with no name,
 * description, value, text or naming attribute (`aria-label`, `id`, `name`, `class`)
 * to tell it by. The panels' search filters on the text, so a search for the
 * chosen option would otherwise still find it.
 *
 * @internal Also for any other view that singles one node out, such as
 * `testing`'s timeline naming the focused node. Not a stability promise.
 */
export function asStop(node: SemanticNode): SemanticNode {
  if (!node.a11y.choiceWithheld) return node;
  const attributes: Record<string, string> = {};
  for (const name of STOP_ATTRIBUTES) {
    const value = node.dom?.attributes[name];
    if (value !== undefined) attributes[name] = value;
  }
  return {
    ...node,
    a11y: {
      ...withoutValue(node.a11y),
      name: REDACTED_VALUE,
      description: "",
    },
    ...(node.dom
      ? {
          dom: {
            ...node.dom,
            attributes,
            textContent: null,
            descendantText: "",
          },
        }
      : {}),
  };
}
