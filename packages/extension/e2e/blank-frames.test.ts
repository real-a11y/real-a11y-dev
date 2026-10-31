/**
 * Frames with no URL of their own: `about:blank` and `srcdoc` frames, and
 * the ones a page writes into with `document.open()`. The content script
 * runs in them under the manifest's `match_about_blank`, so the in-page tree
 * reads them and Chrome's tree follows focus inside them.
 *
 * What makes them their own suite is that nothing in a URL tells them apart.
 * They all show `about:blank` or `about:srcdoc`, their `<iframe>`s carry no
 * `src`, and a frame a script wrote into reports the URL of the page that
 * wrote it. Both trees place such a frame by the mark its script leaves on
 * the element holding it (`src/frame-owner.ts`), which rests on two facts
 * about Chromium that only a real browser can show: a frame of its parent's
 * origin can read `window.frameElement`, and one extension's content scripts
 * see the same object for the same element in every frame of an origin.
 *
 * A third fact is pinned here too: `document.open()` removes every listener
 * the content script had on the document, and detaches the root element it
 * read the tree from. Whether the script loads in the fixture's written
 * frame before the page first writes into it is up to the browser, so the
 * tests that are about this write into the frame again themselves: nothing
 * they check passes unless the script binds to the new document.
 */

import {
  expect,
  frameOf,
  test,
  treeWhen,
  type DomNode,
  type DomTree,
  type NativeHarness,
  type NativeNode,
} from "./harness";

const FIXTURE = "blank-frames.html";

type Page = import("@playwright/test").Page;

/** Wait until every frame the content script runs in shows its button. */
async function framesLoaded(page: Page): Promise<void> {
  for (const id of ["first", "second", "written"]) {
    await page.frameLocator(`#${id}`).locator("#inner").waitFor();
  }
}

// ---- The in-page tree ----------------------------------------------------

test("the in-page tree reads each blank frame under its own <iframe>", async ({
  nav,
}) => {
  const { page, tabId } = await nav.openInPage(FIXTURE);
  await framesLoaded(page);
  // More than once: the frames answer in whatever order they please, and
  // the two `srcdoc` ones can't be told apart by anything but their marks.
  for (let round = 0; round < 3; round++) {
    const tree: DomTree = new Map((await nav.domTree(tabId)).nodes);
    expect(frameOf(tree, "First button"), `round ${round}`).toBe("First frame");
    expect(frameOf(tree, "Second button"), `round ${round}`).toBe(
      "Second frame",
    );
    expect(frameOf(tree, "Written button"), `round ${round}`).toBe(
      "Written frame",
    );
    expect(frameOf(tree, "Outer button")).toBeNull();
    // No content script runs in a sandboxed frame, whose origin is its own:
    // the tree has its <iframe>, and nothing inside it.
    expect(frameOf(tree, "Sandboxed button")).toBeUndefined();
    const sandboxed = [...tree.values()].find(
      (n) => n.dom?.attributes?.["title"] === "Sandboxed frame",
    );
    expect(sandboxed?.childIds).toEqual([]);
  }
});

test("the in-page tree follows a frame the page writes over again", async ({
  nav,
}) => {
  const { page, tabId } = await nav.openInPage(FIXTURE);
  await framesLoaded(page);
  await nav.domTree(tabId);

  for (const label of ["Second write", "Third write"]) {
    const from = await nav.panelMessageCount();
    await page.evaluate(
      (label) =>
        (window as typeof window & { rewrite(label: string): void }).rewrite(
          label,
        ),
      label,
    );
    const tree = await treeWhen(
      nav,
      tabId,
      from,
      (t) => frameOf(t, label) !== undefined,
    );
    expect(frameOf(tree, label)).toBe("Written frame");
    // The document it replaced is gone from the tree, not left beside it.
    expect(frameOf(tree, "Written button")).toBeUndefined();
    expect(frameOf(tree, "First button")).toBe("First frame");
  }
});

test("the in-page tree follows a page that writes its own document over again", async ({
  nav,
}) => {
  // Not a blank frame's matter alone: any document can be replaced under
  // the script that reads it, the top one included.
  const { page, tabId } = await nav.openInPage(FIXTURE);
  await framesLoaded(page);
  await nav.domTree(tabId);

  const from = await nav.panelMessageCount();
  await page.evaluate(() => {
    document.open();
    document.write(
      "<!doctype html><title>Rewritten page</title><h1>After</h1>" +
        "<button>After button</button>",
    );
    document.close();
  });
  const tree = await treeWhen(
    nav,
    tabId,
    from,
    (t) => frameOf(t, "After button") !== undefined,
  );
  expect(frameOf(tree, "After button")).toBeNull();
  expect(frameOf(tree, "Outer button")).toBeUndefined();
  // And goes on following it.
  const later = await nav.panelMessageCount();
  await page.evaluate(() => {
    const added = document.createElement("button");
    added.textContent = "Added later";
    document.body.append(added);
  });
  await treeWhen(
    nav,
    tabId,
    later,
    (t) => frameOf(t, "Added later") !== undefined,
  );
});

test("blank frames a page adds while the panel is open each land under their own <iframe>", async ({
  nav,
}) => {
  const { page, tabId } = await nav.openInPage(FIXTURE);
  await framesLoaded(page);
  await nav.domTree(tabId);

  const from = await nav.panelMessageCount();
  await page.evaluate(() =>
    (window as typeof window & { addFrames(): void }).addFrames(),
  );
  const tree = await treeWhen(
    nav,
    tabId,
    from,
    (t) =>
      frameOf(t, "Late one button") === "Late one frame" &&
      frameOf(t, "Late two button") === "Late two frame",
  );
  // And never under one another's, or under an <iframe> that was there
  // already, in any tree pushed on the way.
  const pushes = (await nav.panelMessages("TREE_DATA", from)).filter(
    (m) => m.tabId === tabId,
  );
  for (const push of pushes) {
    const t: DomTree = new Map(
      (push.payload as { nodes: [string, DomNode][] }).nodes,
    );
    for (const name of ["Late one", "Late two"]) {
      expect([undefined, null, `${name} frame`]).toContain(
        frameOf(t, `${name} button`),
      );
    }
  }
  expect(frameOf(tree, "Written button")).toBe("Written frame");
});

test("a frame that loads long after the page around it was read still lands under its own <iframe>", async ({
  nav,
}) => {
  // The page's tree is sent once for the new <iframe>, before the frame's
  // script has loaded and marked it, and the page doesn't change again. The
  // frame is placed all the same, once the page is asked for its tree.
  const { page, tabId } = await nav.openInPage(FIXTURE);
  await framesLoaded(page);
  await nav.domTree(tabId);

  const from = await nav.panelMessageCount();
  await page.evaluate(() =>
    (window as typeof window & { addSlowFrame(): void }).addSlowFrame(),
  );
  const tree = await treeWhen(
    nav,
    tabId,
    from,
    (t) => typeof frameOf(t, "Slow button") === "string",
  );
  expect(frameOf(tree, "Slow button")).toBe("Slow frame");
  // Until then it was under no <iframe>, rather than guessed under one that
  // has nothing in it, as the sandboxed frame's does.
  const pushes = (await nav.panelMessages("TREE_DATA", from)).filter(
    (m) => m.tabId === tabId,
  );
  for (const push of pushes) {
    const t: DomTree = new Map(
      (push.payload as { nodes: [string, DomNode][] }).nodes,
    );
    expect([undefined, null, "Slow frame"]).toContain(
      frameOf(t, "Slow button"),
    );
  }
});

// ---- Chrome's tree -------------------------------------------------------

/** The node named `name` with role `role` under the `Iframe` row `title`. */
function inFrame(
  nodes: NativeNode[],
  title: string,
  role: string,
  name: string,
): NativeNode | undefined {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const row = nodes.find((n) => n.role === "Iframe" && n.name === title);
  const stack = [...(row?.childIds ?? [])];
  while (stack.length > 0) {
    const n = byId.get(stack.pop()!);
    if (!n) continue;
    if (n.role === role && n.name === name) return n;
    stack.push(...(n.childIds ?? []));
  }
  return undefined;
}

test("a native read numbers each blank frame's document, and tells apart the ones that are alike", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open(FIXTURE);
  await framesLoaded(page);
  const result = await nav.read(tabId, { pageKeys: true });
  expect(result.ok).toBe(true);
  const nodes = result.nodes!;
  const frameRow = (title: string) =>
    nodes.find((n) => n.role === "Iframe" && n.name === title)!;

  const frames = (["First", "Second", "Written"] as const).map((name) => {
    const row = frameRow(`${name} frame`);
    const inner = inFrame(nodes, `${name} frame`, "button", `${name} button`)!;
    expect(row.embedsPageFrame, name).toEqual(expect.any(Number));
    expect(row.embedsPageFrame, name).not.toBe(0);
    expect(inner.pageKey, name).toEqual(expect.any(Number));
    expect(inner.pageFrame, name).toBe(row.embedsPageFrame);
    return { row, inner };
  });
  // Each its own frame.
  expect(new Set(frames.map((f) => f.row.embedsPageFrame)).size).toBe(3);
  // The two `srcdoc` frames' documents are alike: numbered alike, at one
  // URL, and told apart all the same.
  expect(frames[0]!.inner.pageKey).toBe(frames[1]!.inner.pageKey);

  // An empty frame has a document too, and focus can go to it.
  expect(frameRow("Empty frame").embedsPageFrame).toEqual(expect.any(Number));

  // The sandboxed frame is read into the tree, and no content script
  // numbers it.
  const sandboxed = inFrame(
    nodes,
    "Sandboxed frame",
    "button",
    "Sandboxed button",
  );
  expect(sandboxed).toBeDefined();
  expect(sandboxed!.pageKey).toBeUndefined();
  expect(frameRow("Sandboxed frame").embedsPageFrame).toBeUndefined();

  // The top document's rows name no frame.
  const outer = nodes.find((n) => n.name === "Outer button")!;
  expect(outer.pageKey).toEqual(expect.any(Number));
  expect(outer.pageFrame).toBeUndefined();
});

test("focus inside each blank frame selects that frame's own row, with nothing read or done on the page", async ({
  nav,
}) => {
  const page = await nav.showNative(FIXTURE);
  await framesLoaded(page);
  // The tree shown was read as the page loaded: read it again now that
  // every frame has, as the user's own Refresh does.
  await refresh(nav);
  const reads = (await nav.nativeReads()).length;
  const selected = nav.panel.locator('[role="treeitem"][aria-selected="true"]');

  for (const name of ["First", "Second", "Written", "First"]) {
    await page.frameLocator(`#${name.toLowerCase()}`).locator("#inner").focus();
    await expect(selected).toHaveAccessibleName(
      new RegExp(`^button "${name} button"`),
    );
  }
  // And back out to the top document.
  await page.locator("#outer").focus();
  await expect(selected).toHaveAccessibleName(/^button "Outer button"/);

  await page.waitForTimeout(500);
  expect(await nav.nativeActs()).toEqual([]);
  expect(await nav.nativeReads()).toHaveLength(reads);
});

test("focus inside a frame the page wrote over since the read selects the frame's row, and the element's own once it is read again", async ({
  nav,
}) => {
  const page = await nav.showNative(FIXTURE);
  await framesLoaded(page);
  await refresh(nav);
  const selected = nav.panel.locator('[role="treeitem"][aria-selected="true"]');

  await page.evaluate(() =>
    (window as typeof window & { rewrite(label: string): void }).rewrite(
      "Rewritten button",
    ),
  );
  const inner = page.frameLocator("#written").locator("#inner");
  await expect(inner).toHaveText("Rewritten button");
  // None of the new document's elements were there to be numbered: the
  // nearest row is the frame's.
  await inner.focus();
  await expect(selected).toHaveAccessibleName(/^Iframe "Written frame"/);

  await page.locator("#outer").focus();
  await expect(selected).toHaveAccessibleName(/^button "Outer button"/);
  await refresh(nav);
  await inner.focus();
  await expect(selected).toHaveAccessibleName(/^button "Rewritten button"/);
});

/** Read Chrome's tree again, as the panel's Refresh does, and wait for it. */
async function refresh(nav: NativeHarness): Promise<void> {
  const before = (await nav.nativeReads()).length;
  await nav.panel.getByRole("button", { name: "Refresh native tree" }).click();
  await expect
    .poll(async () => (await nav.nativeReads())[before]?.done)
    .toBe(true);
}
