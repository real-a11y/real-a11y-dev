/**
 * A popover invoker's `expanded` state, from both producers in real Chromium.
 *
 * `dom-extractor.test.ts` pins the rule in jsdom, which has no popovers: it
 * fakes `:popover-open`, and cannot open one, click an invoker, or reflect an
 * element set on `popoverTargetElement`. This pins the rule against the tree
 * it was measured from, so a Chromium milestone that changes it fails here:
 * each case states what Chromium reports, and the DOM producer must agree.
 *
 * Run: `pnpm --filter @real-a11y-dev/browser test:e2e`
 */

import { nativeTree, pageBundleSource } from "@real-a11y-dev/browser";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

afterAll(async () => {
  await browser.close();
});

/** The roles of the invokers below. */
const ROLES = ["button", "radio", "menuitem"];

/** Each invoker's `expanded` state by accessible name, from both producers. */
async function expandedByName(): Promise<{
  dom: Record<string, unknown>;
  native: Record<string, unknown>;
}> {
  await page.addScriptTag({ content: pageBundleSource() });
  const dom = await page.evaluate((roles) => {
    const ra = (globalThis as Record<string, unknown>).__realA11y__ as {
      extractA11yTree(root: Element): {
        nodes: Map<
          string,
          {
            a11y: {
              role: string;
              name: string;
              states: Record<string, unknown>;
            };
          }
        >;
      };
    };
    const out: Record<string, unknown> = {};
    for (const node of ra.extractA11yTree(document.body).nodes.values())
      if (roles.includes(node.a11y.role))
        out[node.a11y.name] = node.a11y.states["expanded"] ?? "unset";
    return out;
  }, ROLES);
  const native: Record<string, unknown> = {};
  for (const node of (await nativeTree(page)).nodes.values())
    if (ROLES.includes(node.a11y.role))
      native[node.a11y.name] = node.a11y.states["expanded"] ?? "unset";
  return { dom, native };
}

describe("a popover invoker's expanded state, against Chromium", () => {
  it("is whether the popover is showing, or else aria-expanded", async () => {
    await page.setContent(`
      <div id="closed" popover="manual">x</div>
      <div id="open" popover="manual">x</div>
      <div id="plain">x</div>
      <dialog id="dialog">x</dialog>
      <button popovertarget="closed" aria-expanded="true">closed</button>
      <button popovertarget="open" aria-expanded="false">open</button>
      <input type="button" popovertarget="open" value="input">
      <button popovertarget="open" popovertargetaction="hide">action hide</button>
      <button commandfor="open" command="Show-Popover">command</button>
      <button commandfor="closed" command="toggle-popover" popovertarget="open">command outranks</button>
      <button commandfor="plain" command="toggle-popover" aria-expanded="true">command, not a popover</button>
      <button commandfor="dialog" command="show-modal" popovertarget="open">other command</button>
      <button popovertarget="nowhere" aria-expanded="true">missing</button>
      <button popovertarget="plain">not a popover</button>
      <button disabled popovertarget="open" aria-expanded="false">disabled</button>
      <form><button popovertarget="open">submits</button></form>
      <form><button commandfor="open" command="toggle-popover">plain in a form</button></form>
      <button role="radio" aria-checked="false" popovertarget="open">radio</button>
      <button role="menuitem" popovertarget="closed">menuitem</button>
    `);
    await page.evaluate(() =>
      (document.getElementById("open") as HTMLElement).showPopover(),
    );

    const { dom, native } = await expandedByName();
    const expected = {
      closed: false,
      open: true,
      input: true,
      "action hide": true,
      command: true,
      "command outranks": false,
      "command, not a popover": false,
      "other command": true,
      missing: true,
      "not a popover": "unset",
      disabled: false,
      submits: "unset",
      "plain in a form": true,
      radio: "unset",
      menuitem: false,
    };
    expect(native).toMatchObject(expected);
    expect(dom).toMatchObject(expected);
  });

  it("follows a click on the invoker, and its close button falls back", async () => {
    await page.setContent(`
      <button popovertarget="menu">Menu</button>
      <div id="menu" popover>
        <button popovertarget="menu" popovertargetaction="hide">Close</button>
        <button popovertarget="menu" aria-expanded="false">Close labelled</button>
      </div>
    `);
    await page.click("text=Menu");

    const { dom, native } = await expandedByName();
    const expected = {
      Menu: true,
      // Inside the popover it invokes.
      Close: "unset",
      "Close labelled": false,
    };
    expect(native).toMatchObject(expected);
    expect(dom).toMatchObject(expected);
  });

  it("resolves an element script set, across a shadow root", async () => {
    await page.setContent(`
      <div id="host"></div>
      <div id="menu" popover>x</div>
    `);
    await page.evaluate(() => {
      const host = document.getElementById("host")!;
      host.attachShadow({ mode: "open" }).innerHTML =
        `<button aria-expanded="false">Shadow</button>
         <button popovertarget="menu" aria-expanded="true">Shadow by id</button>`;
      const menu = document.getElementById("menu") as HTMLElement;
      (
        host.shadowRoot!.querySelector("button") as HTMLButtonElement
      ).popoverTargetElement = menu;
      menu.showPopover();
    });

    const { dom, native } = await expandedByName();
    const expected = {
      Shadow: true,
      // An id names nothing outside the invoker's own tree.
      "Shadow by id": true,
    };
    expect(native).toMatchObject(expected);
    expect(dom).toMatchObject(expected);
  });

  // LiveTreeExtractor finds the invokers to re-read by these attributes, so
  // one linked from script must carry them too.
  it("sets the attribute when script links an invoker", async () => {
    await page.setContent(`
      <button id="target">Target</button>
      <button id="command" command="toggle-popover">Command</button>
      <div id="menu" popover>x</div>
    `);
    const attrs = await page.evaluate(() => {
      const menu = document.getElementById("menu")!;
      const target = document.getElementById("target") as HTMLButtonElement;
      const command = document.getElementById(
        "command",
      ) as HTMLButtonElement & {
        commandForElement: Element | null;
      };
      target.popoverTargetElement = menu;
      command.commandForElement = menu;
      return [
        target.getAttribute("popovertarget"),
        command.getAttribute("commandfor"),
      ];
    });
    expect(attrs).toEqual(["", ""]);
  });
});
