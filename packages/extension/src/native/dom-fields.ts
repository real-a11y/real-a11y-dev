/**
 * What CDP's DOM agent says of form fields, for the native read, split out of
 * `native-core.ts`: the fields inside an element ({@link fieldsWithin}), and
 * whether a field's markup says it is sensitive ({@link isSensitiveMarkup}).
 */

import { isSensitiveFieldAttributes } from "@real-a11y-dev/core";

import type { CdpTransport } from "./native-core.js";
import type { CdpDomNode } from "./page-keys.js";

/** CDP's `DOM.Node`, as far as {@link fieldsWithin} reads it. */
interface DescribedNode {
  backendNodeId: number;
  localName?: string;
  shadowRootType?: string;
  children?: DescribedNode[];
  shadowRoots?: DescribedNode[];
}

const FIELD_TAGS = new Set(["input", "textarea", "select"]);

/**
 * The backend ids of the `<input>`, `<textarea>` and `<select>` elements at or
 * inside element `backendNodeId`, from CDP's DOM agent — through author shadow
 * roots, whose content names things too, but not into a field's own
 * user-agent internals or a frame's document. `undefined` when the agent
 * can't describe it.
 */
export async function fieldsWithin(
  transport: CdpTransport,
  backendNodeId: number,
): Promise<number[] | undefined> {
  try {
    const { node } = await transport.send<{ node: DescribedNode }>(
      "DOM.describeNode",
      { backendNodeId, depth: -1, pierce: true },
    );
    const fields: number[] = [];
    const stack = [node];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (FIELD_TAGS.has(cur.localName ?? "")) fields.push(cur.backendNodeId);
      stack.push(...(cur.children ?? []));
      for (const root of cur.shadowRoots ?? []) {
        if (root.shadowRootType !== "user-agent") stack.push(root);
      }
    }
    return fields;
  } catch {
    return undefined;
  }
}

/** A field whose markup says it is sensitive (core's
 *  `isSensitiveFieldAttributes`), as `DOM.getDocument` describes it. Any
 *  `type` or `autocomplete` attribute counts: a namespaced one reads the same
 *  name, and the first need not be the one the field goes by. */
export function isSensitiveMarkup(node: CdpDomNode): boolean {
  const tag = node.localName ?? "";
  if (!FIELD_TAGS.has(tag)) return false;
  const attributes = node.attributes ?? [];
  for (let i = 0; i + 1 < attributes.length; i += 2) {
    const name = attributes[i];
    const value = attributes[i + 1];
    if (
      (name === "type" && isSensitiveFieldAttributes(tag, { type: value })) ||
      (name === "autocomplete" &&
        isSensitiveFieldAttributes(tag, { autocomplete: value }))
    ) {
      return true;
    }
  }
  return false;
}
