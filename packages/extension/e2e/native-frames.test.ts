/**
 * The native tree reads into frames: a same-origin `<iframe>`, in the top
 * frame's own renderer and debugger session, and a cross-origin one, which
 * Chromium runs out of process and the read reaches through a child session
 * of the same attach. Each frame's content sits under its `Iframe` row, an
 * action on it lands in that frame, and a card field inside it is withheld
 * the same as one in the top frame.
 */

import { expect, test, type NativeHarness, type NativeNode } from "./harness";

type Page = import("@playwright/test").Page;
type Frame = import("@playwright/test").Frame;

/** Open the fixture and wait for both frames' documents to have loaded. */
async function openFrames(nav: NativeHarness) {
  const { page, tabId } = await nav.open("native-frames.html");
  const frame = async (which: "same" | "cross"): Promise<Frame> => {
    await expect
      .poll(() => page.frames().some((f) => f.url().endsWith(`?${which}`)))
      .toBe(true);
    const f = page.frames().find((x) => x.url().endsWith(`?${which}`))!;
    await f.locator("#inner").waitFor();
    return f;
  };
  return {
    page,
    tabId,
    same: await frame("same"),
    cross: await frame("cross"),
  };
}

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

test("reads a same-origin and a cross-origin frame under their iframe rows", async ({
  nav,
}) => {
  const { tabId } = await openFrames(nav);
  const nodes = await nav.readNodes(tabId);

  const same = inFrame(nodes, "Same origin frame", "button", "Inner save");
  const cross = inFrame(nodes, "Cross origin frame", "button", "Inner save");
  expect(same?.id).toMatch(/^ax-dom-\d+$/);
  // Out of process: its backend ids restart, so its rows carry the frame.
  expect(cross?.id).toMatch(/^ax-dom-\d+@[0-9A-F]+\.[0-9A-F]+$/);
  expect(
    inFrame(nodes, "Cross origin frame", "heading", "Inner heading"),
  ).toBeDefined();

  // The empty frame has nothing to put under its row.
  const empty = nodes.find(
    (n) => n.role === "Iframe" && n.name === "Empty frame",
  );
  expect(empty?.childIds ?? []).toEqual([]);
});

test("withholds a card number inside either frame", async ({ nav }) => {
  const { tabId } = await openFrames(nav);
  const result = await nav.read(tabId);
  expect(result.ok).toBe(true);
  const nodes = result.nodes!;
  for (const title of ["Same origin frame", "Cross origin frame"]) {
    // Named by its own `<label>`, its value withheld.
    const card = inFrame(nodes, title, "textbox", "Card number");
    expect(card?.redacted).toBe(true);
  }
  expect(JSON.stringify(result)).not.toContain("4111111111111111");
});

test("an action on a frame's row lands in that frame", async ({ nav }) => {
  const { tabId, same, cross } = await openFrames(nav);
  const nodes = await nav.readNodes(tabId);

  for (const [title, frame] of [
    ["Same origin frame", same],
    ["Cross origin frame", cross],
  ] as const) {
    const button = inFrame(nodes, title, "button", "Inner save")!;
    expect(await nav.act(tabId, button.id, "click")).toEqual({
      success: true,
    });
    await expect(frame.locator("#inner")).toHaveAttribute(
      "data-clicked",
      "true",
    );
  }
});

test("an action on a frame's row is refused once the frame has navigated", async ({
  nav,
}) => {
  // The frame keeps its id across a navigation; the elements its old rows
  // named are gone, and their backend ids may name others now.
  const { tabId, cross } = await openFrames(nav);
  const nodes = await nav.readNodes(tabId);
  const button = inFrame(nodes, "Cross origin frame", "button", "Inner save")!;

  await cross.evaluate(() => {
    location.href = location.href.replace("?cross", "?cross-next");
  });
  await expect.poll(() => cross.url()).toContain("?cross-next");
  await cross.locator("#inner").waitFor();

  expect(await nav.act(tabId, button.id, "click")).toMatchObject({
    success: false,
    error: "page navigated — reload the native tree",
  });
  await expect(cross.locator("#inner")).not.toHaveAttribute(
    "data-clicked",
    "true",
  );
});

/** Bring the fixture forward, reload the panel and show its native tree. */
async function showNative(nav: NativeHarness): Promise<{
  page: Page;
  cross: Frame;
}> {
  const { page, cross } = await openFrames(nav);
  await page.bringToFront();
  await nav.panel.reload();
  const toggle = nav.panel.getByRole("button", { name: "NATIVE", exact: true });
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  await toggle.click();
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  return { page, cross };
}

test("the panel shows a frame's content under its row, and marks only the empty frame", async ({
  nav,
}) => {
  await showNative(nav);
  for (const title of ["Same origin frame", "Cross origin frame"]) {
    const row = nav.panel.getByRole("treeitem", { name: new RegExp(title) });
    await expect(row).toHaveAttribute("aria-expanded", "true");
    await expect(row.locator(".sn-iframe-badge")).toHaveCount(0);
  }
  await expect(
    nav.panel.getByRole("treeitem", { name: "Inner save" }),
  ).toHaveCount(2);
  await expect(
    nav.panel
      .getByRole("treeitem", { name: /Empty frame/ })
      .locator(".sn-iframe-badge"),
  ).toHaveText(/^embedded/);
});

test("selecting a row in a cross-origin frame outlines it inside that frame", async ({
  nav,
}) => {
  const { cross } = await showNative(nav);
  const rows = nav.panel.getByRole("treeitem", { name: "Inner save" });
  await rows.last().click({ position: { x: 5, y: 5 } });

  await expect
    .poll(
      () =>
        cross.evaluate(() => {
          const el = document.getElementById("__sn-highlight");
          return el !== null && el.style.display !== "none";
        }),
      { timeout: 5_000 },
    )
    .toBe(true);
  await expect
    .poll(() => cross.evaluate(() => document.activeElement?.id), {
      timeout: 5_000,
    })
    .toBe("inner");
});

test("hovering a row in a cross-origin frame outlines it there, in place", async ({
  nav,
}) => {
  const { cross } = await showNative(nav);
  const overlayShown = () =>
    cross.evaluate(() => {
      const el = document.getElementById("__sn-highlight");
      return el !== null && el.style.display !== "none";
    });
  expect(await overlayShown()).toBe(false);
  await nav.panel
    .getByRole("treeitem", { name: "Inner save" })
    .last()
    .hover({ position: { x: 5, y: 5 } });
  await expect.poll(overlayShown, { timeout: 5_000 }).toBe(true);
  // A preview: focus stays where it was.
  expect(await cross.evaluate(() => document.activeElement?.id)).not.toBe(
    "inner",
  );
});

test("a pick inside either frame selects that frame's row", async ({ nav }) => {
  const { page, same, cross } = await openFrames(nav);
  await page.bringToFront();
  await nav.panel.reload();
  const toggle = nav.panel.getByRole("button", { name: "NATIVE", exact: true });
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  await toggle.click();
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  const pick = nav.panel.getByRole("button", { name: "Pick element in page" });
  const selected = nav.panel.locator('[role="treeitem"][aria-selected="true"]');

  for (const [frame, id] of [
    [same, /^ax-dom-\d+$/],
    [cross, /^ax-dom-\d+@[0-9A-F]+\.[0-9A-F]+$/],
  ] as const) {
    await pick.click();
    await expect(pick).toHaveAttribute("aria-pressed", "true");
    // An out-of-process frame is armed once its session is announced, a
    // moment after the tab's own inspect mode. Armed, Chromium's inspect
    // tool takes the pointer, so the page stops seeing it: poll for that
    // rather than wait a fixed time.
    await expect
      .poll(async () => {
        await frame.evaluate(() => {
          (window as { __seen?: boolean }).__seen = false;
          document.addEventListener(
            "mousemove",
            () => ((window as { __seen?: boolean }).__seen = true),
            { once: true },
          );
        });
        await frame.locator("#inner").hover({ position: { x: 3, y: 3 } });
        await frame.locator("#inner").hover({ position: { x: 6, y: 6 } });
        return frame.evaluate(() => (window as { __seen?: boolean }).__seen);
      })
      .toBe(false);
    await frame.locator("#inner").click();
    await expect(pick).toHaveAttribute("aria-pressed", "false");
    // The pick took the click: it never reached the page.
    await expect(frame.locator("#inner")).not.toHaveAttribute(
      "data-clicked",
      "true",
    );
    // Both frames' buttons are named alike: tell them apart by row id.
    await expect(selected).toHaveAttribute("data-node-id", id);
    await expect(selected).toHaveAccessibleName(/Inner save/);
  }
});
