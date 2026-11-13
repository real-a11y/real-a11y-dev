import type { TreeProducerKind, TreeSource } from "../types.js";

/**
 * The provenance stamp on an `ExtractionResult`, for either producer:
 * which one built the tree, the Chromium milestone a native tree was read
 * from, and whether it was built in strict mode. One builder, so the two
 * producers stamp alike, and a key never appears holding `undefined`.
 */
export function treeSource(
  producer: TreeProducerKind,
  { chrome, redactInput }: { chrome?: string; redactInput?: boolean } = {},
): TreeSource {
  return {
    producer,
    ...(chrome ? { chrome } : {}),
    ...(redactInput ? { redactInput: true } : {}),
  };
}
