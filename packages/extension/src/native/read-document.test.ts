import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CdpTransport, NativeTreeResult } from "./native-core.js";

/**
 * Which document a read was of: the one `readNativeTree` began on, and
 * whether another took its place before the read ended, as a navigation
 * that commits in between does.
 */

const read = vi.hoisted(() => ({
  result: undefined as NativeTreeResult | undefined,
}));
vi.mock("./native-core.js", () => ({
  readNativeTree: vi.fn(async () => read.result),
}));

const { documentFields, readNativeTreeChecked } =
  await import("./read-document.js");

/** A read of a page whose document began as `documentId`. */
function resultOf(documentId?: string): NativeTreeResult {
  return {
    nodes: [],
    serialized: "",
    rawCount: 0,
    keptCount: 0,
    rootId: "",
    ...(documentId === undefined ? {} : { documentId }),
  };
}

/** A transport whose page shows `loaderId` once the tree is read, or
 *  fails to say when it is an Error. */
function transportShowing(loaderId: string | Error | undefined): {
  transport: CdpTransport;
  sent: string[];
} {
  const sent: string[] = [];
  const transport = {
    send: async (method: string) => {
      sent.push(method);
      if (loaderId instanceof Error) throw loaderId;
      return { frameTree: { frame: { loaderId } } };
    },
  } as unknown as CdpTransport;
  return { transport, sent };
}

describe("readNativeTreeChecked", () => {
  beforeEach(() => {
    read.result = undefined;
  });

  it("leaves a read alone when its document is still the page's", async () => {
    read.result = resultOf("D1");
    const { transport, sent } = transportShowing("D1");
    const checked = await readNativeTreeChecked(transport);
    expect(checked).toBe(read.result);
    expect(checked.documentChanged).toBeUndefined();
    expect(sent).toEqual(["Page.getFrameTree"]);
  });

  it("says when another document took its place as it was read", async () => {
    read.result = resultOf("D1");
    const checked = await readNativeTreeChecked(
      transportShowing("D2").transport,
    );
    // The id stays the one it began on: the panel reads the new page again.
    expect(checked).toEqual({ ...resultOf("D1"), documentChanged: true });
  });

  it("asks nothing more of a read with no document id", async () => {
    read.result = resultOf();
    const { transport, sent } = transportShowing("D2");
    expect(await readNativeTreeChecked(transport)).toBe(read.result);
    expect(sent).toEqual([]);
  });

  it("takes a page that won't say for one that didn't change", async () => {
    read.result = resultOf("D1");
    expect(
      (await readNativeTreeChecked(transportShowing(undefined).transport))
        .documentChanged,
    ).toBeUndefined();
    expect(
      (
        await readNativeTreeChecked(
          transportShowing(new Error("detached")).transport,
        )
      ).documentChanged,
    ).toBeUndefined();
  });
});

describe("documentFields", () => {
  it("gives the reply the document a read began on, and whether it changed", () => {
    expect(documentFields(resultOf("D1"))).toEqual({ documentId: "D1" });
    expect(
      documentFields({ ...resultOf("D1"), documentChanged: true }),
    ).toEqual({ documentId: "D1", documentChanged: true });
    expect(documentFields(resultOf())).toEqual({});
  });
});
