/**
 * Which document a read of Chrome's tree was of, for the NATIVE_READ reply.
 *
 * `readNativeTree` asks for the page's document before it reads the tree, so
 * a navigation that commits in between can only name the old document over
 * the new one's rows. The panel then reads the new page again, as it should,
 * but the rows themselves belong to neither tree it could compare them with
 * (`compareRead` in `use-native-changes.ts`). Asking again once the tree is
 * read tells such a read from the rest.
 */

import {
  readNativeTree,
  type CdpTransport,
  type NativeTreeResult,
  type ReadNativeTreeOptions,
} from "./native-core.js";

/** A read, and whether the page's document changed while it was taken. */
export interface CheckedNativeTreeResult extends NativeTreeResult {
  documentChanged?: true;
}

/** The top frame's document now, or undefined where Chromium doesn't say. */
async function documentNow(
  transport: CdpTransport,
): Promise<string | undefined> {
  return transport
    .send<{
      frameTree?: { frame?: { loaderId?: string } };
    }>("Page.getFrameTree")
    .then(
      (r) => r.frameTree?.frame?.loaderId,
      () => undefined,
    );
}

/** `readNativeTree`, saying whether the document changed under it. */
export async function readNativeTreeChecked(
  transport: CdpTransport,
  options?: ReadNativeTreeOptions,
): Promise<CheckedNativeTreeResult> {
  const result = await readNativeTree(transport, options);
  if (result.documentId === undefined) return result;
  const after = await documentNow(transport);
  return after !== undefined && after !== result.documentId
    ? { ...result, documentChanged: true }
    : result;
}

/** The reply's fields for the document a read was of: the one it began
 *  on, and whether another took its place before it ended. */
export function documentFields(result: CheckedNativeTreeResult): {
  documentId?: string;
  documentChanged?: true;
} {
  return {
    ...(result.documentId !== undefined
      ? { documentId: result.documentId }
      : {}),
    ...(result.documentChanged ? { documentChanged: true } : {}),
  };
}
