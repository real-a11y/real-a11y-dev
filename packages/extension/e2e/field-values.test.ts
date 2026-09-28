/**
 * ADR-0001's field values, through the real build in real Chromium.
 *
 * The A11y view shows the value a screen reader announces and the DOM view
 * the raw DOM value; a sensitive field reads `[redacted]` in both, never its
 * contents or its length. A `<select>` is the field that tells the two apart:
 * it announces its option LABEL ("Spain") and holds its option VALUE ("es").
 *
 * Both producers are covered, because they get there differently. The DOM
 * producer's content script computes `a11y.value` in the page. NATIVE takes
 * Chromium's own AX value, and only once `pageReadValue` has classified the
 * element in-page — Chromium masks a password with bullets but sends a
 * `cc-number` text field in plaintext, so its payload cannot be the gate.
 */

import { expect, node, test, type NativeHarness } from "./harness";

type PanelPage = import("@playwright/test").Page;

const SECRETS = ["hunter2", "4111111111111111"];

/** Click a panel control from inside the panel. A Playwright click would
 *  bring the panel's own tab to the front, and the panel resolves its target
 *  as the active tab — see `panel-ui.test.ts`'s header. */
async function press(
  panel: PanelPage,
  label: string,
  within = "body",
): Promise<void> {
  await panel.evaluate(
    ([want, scope]) => {
      const button = [...document.querySelectorAll(`${scope} button`)].find(
        (b) =>
          b.textContent?.trim() === want ||
          b.getAttribute("aria-label") === want,
      ) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`no button "${want}" in ${scope}`);
      button.click();
    },
    [label, within] as const,
  );
}

/** The fixture in the foreground and the panel freshly mounted on it. */
async function showFixture(nav: NativeHarness): Promise<PanelPage> {
  const { page } = await nav.open("field-values.html");
  await page.bringToFront();
  await nav.panel.reload();
  return page;
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
  // aria-valuetext, which Chromium's CDP payload does not carry at all.
  expect(node(tree, "slider", "Volume").value).toBe("Loud");
  // An editor's content is page content: collapsed, as announced.
  expect(node(tree, "textbox", "Message").value).toBe("Hello world");

  const wire = JSON.stringify(result);
  for (const secret of SECRETS) expect(wire).not.toContain(secret);
  // Chromium's own mask for the password: one bullet per character.
  expect(wire).not.toContain("•");
});

test("NATIVE panel: the tree shows the announced label, and a retype starts from the raw value", async ({
  nav,
}) => {
  const page = await showFixture(nav);
  const nativeToggle = nav.panel.getByRole("button", {
    name: "NATIVE",
    exact: true,
  });
  await expect(nativeToggle).toBeVisible({ timeout: 20_000 });
  await nativeToggle.click();
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
});

test("DOM mode: the A11y view shows the announced label, the DOM view the raw value", async ({
  nav,
}) => {
  await showFixture(nav);
  // The DOM producer connects on its own; a row on screen is the tree landing.
  await expect
    .poll(() => nav.panel.locator(".sn-node").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await press(nav.panel, "Expand all");

  const valueOf = (rowText: RegExp) =>
    nav.panel
      .locator(".sn-node", { hasText: rowText })
      .locator(".sn-field-value");

  // A11y view (the default).
  await expect(valueOf(/combobox\s*Country/)).toHaveText('= "Spain"');
  await expect(valueOf(/textbox\s*Password/)).toHaveText('= "[redacted]"');
  await expect(valueOf(/textbox\s*Card number/)).toHaveText('= "[redacted]"');
  await expect(valueOf(/slider\s*Volume/)).toHaveText('= "Loud"');

  // DOM view — the view-mode toggle, not the dogfood build's producer one.
  // Switching re-extracts, and the new tree lands with its own default
  // expansion at some point after the click, so expand until the row shows.
  await press(nav.panel, "DOM", '[aria-label="Tree view mode"]');
  await expect(async () => {
    await press(nav.panel, "Expand all");
    await expect(valueOf(/<select>/)).toHaveText('value="es"', {
      timeout: 1_000,
    });
  }).toPass({ timeout: 15_000 });
  await expect(
    nav.panel.locator(".sn-field-value", { hasText: 'value="[redacted]"' }),
  ).toHaveCount(2);
  await expect(
    nav.panel.locator(".sn-field-value", { hasText: 'value="80"' }),
  ).toHaveCount(1);

  for (const secret of SECRETS) {
    await expect(nav.panel.locator(".sn-tree")).not.toContainText(secret);
  }
  await expect(nav.panel.locator(".sn-tree")).not.toContainText("•");
});
