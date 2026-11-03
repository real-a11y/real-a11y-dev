/**
 * ADR-0001's field values, through the real build in real Chromium.
 *
 * Chrome's tree shows the value a screen reader announces; a sensitive field
 * reads `[redacted]`, never its contents or its length. A `<select>` is the
 * field that tells the announced value from the raw one: it announces its
 * option LABEL ("Spain") and holds its option VALUE ("es"). It takes
 * Chromium's own AX value only once `pageReadValue` has classified the
 * element in the page — Chromium masks a password with bullets but sends a
 * `cc-number` text field in plaintext, so its payload cannot be the gate.
 *
 * A TAB row's edit box gets there differently: it opens on the field state
 * the content script reads in the page (`GET_FIELD_STATE`), and the TAB
 * view's rows show no value at all.
 */

import { expect, node, nodes, test, type NativeHarness } from "./harness";

type PanelPage = import("@playwright/test").Page;

const SECRETS = ["hunter2", "4111111111111111", "2031", "November"];

/** The fixture in the foreground and the panel freshly mounted on it. */
async function showFixture(
  nav: NativeHarness,
  fixture = "field-values.html",
): Promise<PanelPage> {
  const { page } = await nav.open(fixture);
  await page.bringToFront();
  await nav.panel.reload();
  return page;
}

/** The fixture with the TAB view on screen. */
async function showTabRows(
  nav: NativeHarness,
  fixture: string,
): Promise<PanelPage> {
  const { page } = await nav.showTabOrder(fixture);
  // The edit box opens on its field's state, which it asks the page for.
  await nav.routeToPage(["GET_FIELD_STATE", "DISPATCH_ACTION"]);
  return page;
}

/**
 * A TAB row's edit box. Everything from inside the panel: a Playwright click
 * or keypress would bring the panel's own tab to the front first.
 */
function tabRowEditBox(nav: NativeHarness) {
  const box = nav.panel.locator(".sn-input-panel-field");
  /** Open the edit box of the tab stop named `name`: select it, then
   *  Activate, once the list shows it selected. */
  const open = async (name: string) => {
    await nav.panel.evaluate((want) => {
      const stop = [
        ...document.querySelectorAll(
          '[aria-label="Tab sequence"] [role="option"]',
        ),
      ].find((o) => o.querySelector(".sn-tab-name")?.textContent === want);
      if (!stop) throw new Error(`no tab stop ${want}`);
      (stop as HTMLElement).click();
    }, name);
    await expect(
      nav.tabStops().getByRole("option", { selected: true }),
    ).toContainText(name);
    await nav.panel.evaluate(() => {
      const activate = [
        ...document.querySelectorAll<HTMLButtonElement>(".sn-list-action-btn"),
      ].find((b) => b.textContent?.trim() === "Activate");
      if (!activate || activate.disabled) throw new Error("no Activate");
      activate.click();
    });
    await expect(box, name).toBeVisible();
  };
  const key = (k: "Enter" | "Escape") =>
    nav.panel.evaluate((which) => {
      document
        .querySelector(".sn-input-panel-field")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: which, bubbles: true }),
        );
    }, k);
  const type = (text: string) =>
    nav.panel.evaluate((value) => {
      const input = document.querySelector<HTMLInputElement>(
        ".sn-input-panel-field",
      )!;
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, text);
  return { box, open, key, type };
}

test("NATIVE: a select reads its label, a sensitive field [redacted], over the wire", async ({
  nav,
}) => {
  const { tabId } = await nav.open("field-values.html");
  const result = await nav.read(tabId);
  expect(result.ok).toBe(true);
  const tree = result.nodes ?? [];

  const country = node(tree, "combobox", "Country");
  expect(country.value).toBe("Spain");
  // The raw value rides along only for a retype to start from.
  expect(country.rawValue).toBe("es");

  expect(node(tree, "textbox", "Email").value).toBe("jane@example.com");
  expect(node(tree, "textbox", "Password").value).toBe("[redacted]");
  expect(node(tree, "textbox", "Card number").value).toBe("[redacted]");
  // A sensitive field Chromium builds from parts: the field says it once,
  // and its Month and Year spinbuttons (UA shadow DOM) say nothing.
  expect(node(tree, "DateTime", "Card expiry").value).toBe("[redacted]");
  for (const part of nodes(tree, "spinbutton")) {
    expect(part.value, part.name).toBeUndefined();
  }
  // aria-valuetext, which Chromium's CDP payload does not carry at all.
  expect(node(tree, "slider", "Volume").value).toBe("Loud");
  // An editor's content is page content: collapsed, as announced.
  expect(node(tree, "textbox", "Message").value).toBe("Hello world");

  // No file yet: no value — not Chromium's "No file chosen".
  expect(node(tree, "button", "Upload").value).toBeUndefined();

  const wire = JSON.stringify(result);
  for (const secret of SECRETS) expect(wire).not.toContain(secret);
  // Chromium's own mask for the password: one bullet per character.
  expect(wire).not.toContain("•");
});

test("NATIVE: a file input reads its chosen file's name, never its fake path", async ({
  nav,
}) => {
  const { page, tabId } = await nav.open("field-values.html");
  await page.setInputFiles("#upload", {
    name: "photo.png",
    mimeType: "image/png",
    buffer: Buffer.from("png"),
  });
  const upload = node(await nav.readNodes(tabId), "button", "Upload");
  expect(upload.value).toBe("photo.png");
  expect(upload.rawValue).toBeUndefined();
});

test("NATIVE panel: the tree shows the announced label, and a retype starts from the raw value", async ({
  nav,
}) => {
  const page = await showFixture(nav);
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await nav.panel.getByRole("button", { name: "Expand all" }).click();

  const country = nav.panel.getByRole("treeitem", { name: "Country" });
  await expect(country).toContainText('= "Spain"');
  await expect(country).not.toContainText('"es"');
  await expect(
    nav.panel.getByRole("treeitem", { name: "Password" }),
  ).toContainText('= "[redacted]"');
  for (const secret of SECRETS) {
    await expect(nav.panel.locator(".sn-tree")).not.toContainText(secret);
  }

  // The announced value is capped at 240 characters; the retype must start
  // from the whole field, or an unedited submit would cut it short.
  const full = await page.locator("#bio").inputValue();
  expect(full.length).toBeGreaterThan(240);
  const bio = nav.panel.getByRole("treeitem", { name: "Bio" });
  await expect(bio).toContainText("…");
  await bio.getByTitle("Type (Enter)").click();
  await expect(nav.panel.locator(".sn-input-panel-field")).toHaveValue(full);
  await nav.panel.locator(".sn-input-panel-field").press("Escape");

  // An editor's retype opens empty (it has no raw value to start from). An
  // untouched Enter must not wipe it; typing and then clearing must.
  const field = nav.panel.locator(".sn-input-panel-field");
  const message = nav.panel.getByRole("treeitem", { name: "Message" });
  await message.getByTitle("Type (Enter)").click();
  await expect(field).toHaveValue("");
  await field.press("Enter");
  await expect(field).toHaveCount(0);
  await expect(page.locator("#editor")).toHaveText("Hello world");

  await message.getByTitle("Type (Enter)").click();
  await field.fill("x");
  await field.fill("");
  await field.press("Enter");
  await expect(page.locator("#editor")).toHaveText("");
});

test("TAB view: a withheld field's edit box masks what is typed, empty or not, and an untouched Enter types nothing", async ({
  nav,
}) => {
  const page = await showTabRows(nav, "retype-mask.html");
  const { box, open: openBox, key, type: typeIntoBox } = tabRowEditBox(nav);
  // The rows show no value, a password's least of all.
  await expect(nav.tabStops()).not.toContainText("hunter2");

  // Each opens empty, in place of a value it can't show, and hides what is
  // typed: a password nobody has typed yet as well as a filled one, a card
  // number and a security code that are text and tel inputs, and an editor
  // holding a card field.
  for (const name of [
    "Enter your password",
    "Current password",
    "Card number",
    "Security code",
    "Payment note",
  ]) {
    await openBox(name);
    await expect(box, name).toHaveAttribute("type", "password");
    await expect(box, name).toHaveValue("");
    await key("Escape");
    await expect(box).toHaveCount(0);
  }
  // Nothing withholds an ordinary field's value, or an editor's, whose box
  // takes lines.
  for (const [name, value, type] of [
    ["Full name", "Jane", "text"],
    ["Notes", "Hello", "textarea"],
  ]) {
    await openBox(name);
    await expect(box, name).toHaveJSProperty("type", type);
    await expect(box, name).toHaveValue(value);
    await key("Escape");
    await expect(box).toHaveCount(0);
  }

  // An untouched Enter cancels: it used to type "" over the password the box
  // couldn't show.
  await openBox("Current password");
  await key("Enter");
  await expect(box).toHaveCount(0);

  // What the user types still goes in.
  await openBox("Enter your password");
  await typeIntoBox("s3cret");
  await key("Enter");
  await expect(page.locator("#pw")).toHaveValue("s3cret");
  // Sent after the cancelled Enter above, so a type it had sent would have
  // landed by now.
  await expect(page.locator("#old")).toHaveValue("hunter2");
});

test("TAB view: an untouched Enter in a rich-text editor's edit box leaves the editor as it was", async ({
  nav,
}) => {
  const page = await showTabRows(nav, "editor-content.html");
  const { box, open, key, type } = tabRowEditBox(nav);
  const contents = () =>
    page
      .locator('[role="textbox"][contenteditable]')
      .evaluateAll((editors) =>
        Object.fromEntries(editors.map((e) => [e.id, e.innerHTML])),
      );
  const before = await contents();

  // Each box opens on the editor's text alone, which a retype would put in
  // place of everything in it: an untouched Enter used to type "" over an
  // image, a field or a divider, and the text back over bold or an image.
  // An editor's box takes lines, and it is unmasked.
  for (const [name, text] of [
    ["Signature", ""],
    ["Order note", ""],
    ["Divider", ""],
    ["Motto", "Stay curious"],
    ["Greeting", "Hello"],
  ]) {
    await open(name);
    await expect(box, name).toHaveJSProperty("type", "textarea");
    await expect(box, name).toHaveValue(text);
    await key("Enter");
    await expect(box, name).toHaveCount(0);
  }

  // What the user types still goes in, in place of what the editor held.
  // Sent after the Enters above, so a type one of them had sent would have
  // landed by now.
  await open("Signature");
  await type("Best, Jane");
  await key("Enter");
  await expect(page.locator("#signature")).toHaveText("Best, Jane");
  await expect(page.locator("#signature img")).toHaveCount(0);

  // Every other editor is as it was.
  const after = await contents();
  expect(Object.keys(after)).toEqual(Object.keys(before));
  for (const id of Object.keys(before)) {
    if (id !== "signature") expect(after[id], id).toBe(before[id]);
  }
  await expect(page.locator("#order-note input")).toHaveValue("3");
  await expect(page.locator("#divider hr")).toHaveCount(1);
  await expect(page.locator("#motto b")).toHaveText("Stay");
  await expect(page.locator("#greeting")).toHaveText("Hello");
  await expect(page.locator("#greeting img")).toHaveCount(1);

  // Typing and then clearing is how a user empties an editor on purpose.
  await open("Divider");
  await type("x");
  await type("");
  await key("Enter");
  await expect(page.locator("#divider hr")).toHaveCount(0);
});
