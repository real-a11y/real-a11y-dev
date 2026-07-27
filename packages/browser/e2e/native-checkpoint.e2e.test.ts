/**
 * The checkpoint's document-replacement detector, against real Chromium.
 *
 * `native-checkpoint.test.ts` pins the policy on hand-built trees. This pins
 * the premise underneath it — that Chromium actually behaves the way the policy
 * assumes — because that is the part a unit test cannot assert and a Chromium
 * milestone could change:
 *
 *   - a replaced document reallocates EVERY backendNodeId (zero shared ids)
 *   - any same-document change keeps at least one
 *
 * Three of these five scenarios are cases where comparing URLs gets the answer
 * wrong, which is why they are here rather than left to the CLI's e2e:
 *
 *   - hash change and SPA `pushState` change the URL while the document lives
 *   - `location.reload()` replaces the document while the URL stays put
 *
 * The fixtures are deliberately `<header>`/`<main>`/`<footer>` — the ordinary
 * page shape, and the one that makes `buildNativeTree` synthesize its `ax-root`
 * wrapper. An earlier version wrapped everything in a single `<main>`, was
 * therefore single-rooted, and never exercised that path; the constant
 * `ax-root` id is shared by every such document, so a navigation between two
 * normal pages read as an in-place change. `keeps the synthesized root in play`
 * below guards the fixture itself, since the bug returns silently the moment
 * these pages stop being multi-rooted.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e`
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  BrowserSession,
  captureNativeCheckpoint,
  diffNativeCheckpoint,
} from "@real-a11y-dev/browser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Real files, not data: URLs — Chromium refuses top-level navigation TO a
// data: URL, so a link between two of them never navigates and the case under
// test would silently not happen.
let startUrl: string;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "real-a11y-checkpoint-"));
  writeFileSync(
    join(dir, "b.html"),
    "<!doctype html><title>B</title>" +
      "<header><h1>Page B</h1></header>" +
      "<main><button>On B</button></main>" +
      "<footer><p>footer B</p></footer>",
  );
  const start = join(dir, "a.html");
  writeFileSync(
    start,
    `<!doctype html><title>A</title>
    <header><h1>Page A</h1></header>
    <main>
      <button id="toggle">Toggle</button>
      <a id="go" href="./b.html">Go to B</a>
      <button id="spa">SPA route</button>
      <button id="hash">Hash</button>
      <button id="reload">Reload</button>
      <div id="panel"></div>
      <script>
        toggle.onclick = () => {
          panel.innerHTML = '<h2>opened</h2><button>Close</button>';
        };
        hash.onclick = () => { location.hash = 'x'; };
        reload.onclick = () => { location.reload(); };
        spa.onclick = () => {
          history.pushState({}, '', '?route=2');
          document.querySelector('main').innerHTML =
            '<h1>Route 2</h1><button>Other</button>';
        };
      </script>
    </main>
    <footer><p>footer A</p></footer>`,
  );
  startUrl = pathToFileURL(start).href;
  // The session's URL gate blocks file:// unless this is set; these fixtures
  // must be real documents on disk for navigation to happen at all.
  process.env.REAL_A11Y_MCP_ALLOW_FILE = "1";
});

const session = new BrowserSession({ headless: true });

afterAll(async () => {
  await session.close();
});

/** Open the fixture, checkpoint, click `id`, and diff — the real loop. */
async function afterClicking(id: string) {
  await session.open(startUrl);
  const checkpoint = captureNativeCheckpoint(
    await session.nativeTree(),
    session.currentUrl() ?? "",
  );
  const target = [...checkpoint.tree.nodes.values()].find(
    (n) => n.dom?.attributes?.id === id,
  );
  expect(target, `fixture must expose #${id} in the native tree`).toBeTruthy();

  const act = await session.act({ nodeId: target!.id, action: "click" });
  expect(act.success).toBe(true);
  // Reactions are async (navigation commit, innerHTML paint) — the CLI settles
  // between steps for the same reason.
  await new Promise((resolve) => setTimeout(resolve, 400));

  const urlAfter = session.currentUrl() ?? "";
  return {
    outcome: diffNativeCheckpoint(
      checkpoint,
      await session.nativeTree(),
      urlAfter,
    ),
    urlChanged: urlAfter !== checkpoint.url,
  };
}

describe("native checkpoint — document replacement in real Chromium", () => {
  it("keeps the synthesized root in play — the fixture must be multi-rooted", async () => {
    // Guards the premise of every test below. `ax-root` is minted for any page
    // with more than one top-level node, and its id is a CONSTANT — so it is
    // present in two unrelated documents and must never count as a survivor.
    await session.open(startUrl);
    const tree = await session.nativeTree();
    expect(tree.rootId).toBe("ax-root");
    expect(tree.nodes.has("ax-root")).toBe(true);
  });

  it("diffs a same-document mutation", async () => {
    const { outcome, urlChanged } = await afterClicking("toggle");
    expect(urlChanged).toBe(false);
    expect(outcome.kind).toBe("diff");
    if (outcome.kind !== "diff") return;
    expect(outcome.changed).toBe(true);
    expect(outcome.rendered).toContain('heading "opened"');
  });

  it("reports a replacement on a real navigation", async () => {
    const { outcome, urlChanged } = await afterClicking("go");
    expect(urlChanged).toBe(true);
    expect(outcome.kind).toBe("replaced");
    if (outcome.kind !== "replaced") return;
    expect(outcome.to).toContain("b.html");
    expect(outcome.from).toContain("a.html");
  });

  it("reports a replacement on a reload, where the URL is unchanged", async () => {
    // The case a URL comparison misses: same address, brand-new document. A
    // diff here would render the entire page as removed and re-added.
    const { outcome, urlChanged } = await afterClicking("reload");
    expect(urlChanged).toBe(false);
    expect(outcome.kind).toBe("replaced");
  });

  it("still diffs a hash change, where the URL IS changed", async () => {
    // The mirror-image case: the address moved, the document did not. The user
    // asked what the interaction changed, and the honest answer is a diff.
    const { outcome, urlChanged } = await afterClicking("hash");
    expect(urlChanged).toBe(true);
    expect(outcome.kind).toBe("diff");
  });

  it("still diffs an SPA route change, where most of the tree is replaced", async () => {
    // Hardest case: pushState moves the URL and the route swap replaces nearly
    // every node — but `main` survives, so the document did, and the diff is
    // exactly the report the user wanted.
    const { outcome, urlChanged } = await afterClicking("spa");
    expect(urlChanged).toBe(true);
    expect(outcome.kind).toBe("diff");
    if (outcome.kind !== "diff") return;
    expect(outcome.rendered).toContain('+ heading "Route 2"');
    expect(outcome.rendered).toContain('- button "SPA route"');
    // The banner is outside <main> and untouched, so it must NOT show as
    // removed — proof this is a real subtree diff, not a whole-page swap.
    expect(outcome.rendered).not.toContain('- heading "Page A"');
  });
});
