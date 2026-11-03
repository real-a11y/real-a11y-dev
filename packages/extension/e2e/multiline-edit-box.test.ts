/**
 * A field that holds more than one line, through the side panel's edit box,
 * from Chrome's tree and from a TAB row, whose box the page's own walk
 * fills: the box shows the field's lines, and an edit keeps them.
 *
 * The box was a one-line `<input>`, which strips line breaks from what it
 * holds. The first keystroke put a textarea's lines back as one, so Enter
 * typed them into the page that way, Shift+Enter set the value rather than
 * starting a line, and the page's walk read an editor's paragraphs as one
 * run of text, `Dear Sam,Thanks!`.
 */

import { expect, test } from "./harness";

const LETTER = "Dear Sam,\nThanks for the books.\n\nBest,\nJo";

test("Chrome's tree: an edit keeps a textarea's lines, and Shift+Enter starts one", async ({
  nav,
}) => {
  const page = await nav.showNative("multiline-fields.html");
  await nav.panel.getByRole("button", { name: "Expand all" }).click();
  const box = nav.panel.locator(".sn-input-panel-field");
  const open = async (name: string) => {
    await nav.panel
      .getByRole("treeitem", { name })
      .getByTitle("Type (Enter)")
      .click();
    // The box takes focus once it has rendered: a key pressed before then
    // lands before its text is selected, and typing replaces it all.
    await expect(box, name).toBeFocused();
  };

  await open("Letter");
  await expect(box).toHaveValue(LETTER);
  await box.press("Control+End");
  await box.press("Shift+Enter");
  await box.pressSequentially("PS: more soon");
  await box.press("Enter");
  await expect(box).toHaveCount(0);
  await expect(page.locator("#letter")).toHaveValue(`${LETTER}\nPS: more soon`);

  // An editor's box opens empty, and takes lines too.
  await open("Shopping list");
  await expect(box).toHaveValue("");
  for (const item of ["Bread", "Butter"]) {
    await box.pressSequentially(item);
    await box.press("Shift+Enter");
  }
  await box.pressSequentially("Jam");
  await box.press("Enter");
  await expect(box).toHaveCount(0);
  await expect
    .poll(() =>
      page.locator("#list").evaluate((el) => (el as HTMLElement).innerText),
    )
    .toBe("Bread\nButter\nJam");
});

test("TAB view: the edit box shows a textarea's lines and an editor's, and an edit keeps them", async ({
  nav,
}) => {
  const { page } = await nav.showTabOrder("multiline-fields.html");
  // The edit box opens on its field's state, which it asks the page for.
  await nav.routeToPage(["GET_FIELD_STATE", "DISPATCH_ACTION"]);

  // Everything from inside the panel: the page's walk acts on the bound tab.
  const box = nav.panel.locator(".sn-input-panel-field");
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
    // Selected once the list has rendered it so: Activate acts on that.
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
  /** Type at the end of the box, as a user adding a line does. */
  const append = (text: string) =>
    nav.panel.evaluate((more) => {
      const field = document.querySelector<
        HTMLInputElement | HTMLTextAreaElement
      >(".sn-input-panel-field")!;
      field.value += more;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }, text);
  const enter = () =>
    nav.panel.evaluate(() => {
      document
        .querySelector(".sn-input-panel-field")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
    });

  await open("Letter");
  await expect(box).toHaveValue(LETTER);
  await append("\nPS");
  await enter();
  await expect(box).toHaveCount(0);
  await expect(page.locator("#letter")).toHaveValue(`${LETTER}\nPS`);

  // An editor's text, line by line: its paragraphs used to run together. The
  // walk's write is text, not markup, so a plain editor like this one shows
  // a line break in it as a space, and one whose style keeps line breaks, as
  // the list's does, shows lines.
  await open("Card");
  await expect(box).toHaveValue("Dear Sam,\nThanks!");
  await append("\nPS");
  await enter();
  await expect(box).toHaveCount(0);
  await expect
    .poll(() => page.locator("#card").textContent())
    .toBe("Dear Sam,\nThanks!\nPS");

  await open("Shopping list");
  await expect(box).toHaveValue("Milk\nEggs");
  await append("\nBread");
  await enter();
  await expect(box).toHaveCount(0);
  await expect
    .poll(() =>
      page.locator("#list").evaluate((el) => (el as HTMLElement).innerText),
    )
    .toBe("Milk\nEggs\nBread");
});
