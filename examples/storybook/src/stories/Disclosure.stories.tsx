import type { Meta, StoryObj } from "@storybook/react";
import { Disclosure } from "../Disclosure.js";

/**
 * Cross-link chips on disclosure pairs (button ↔ menu).
 *
 * Try:
 * 1. Open the "Semantic Navigator" tab.
 * 2. Click "Open settings". A solid `→ menu "Settings menu"` chip appears
 *    on the button row in the panel; a `← button "Open settings…"` chip
 *    appears on the menu row.
 * 3. Click "Open profile". A dashed `→ menu "Profile menu"` chip appears
 *    on that button — the link is inferred because there's no
 *    `aria-controls` attribute on the trigger.
 * 4. Click any chip in the panel — the panel scrolls and flashes the
 *    target row.
 */
const meta: Meta<typeof Disclosure> = {
  title: "Components/Disclosure",
  component: Disclosure,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Disclosure>;

export const ButtonWithMenu: Story = {};
