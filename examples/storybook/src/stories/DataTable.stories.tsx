import type { Meta, StoryObj } from "@storybook/react";
import {
  DataTableCorrect,
  DataTableBroken,
} from "@real-a11y-dev/example-patterns";

/**
 * Content pattern: Data table — paired stories.
 *
 * - **Correct:** native `<table>` + `<caption>` + `<thead>/<tbody>` +
 *   `<th scope="col">` / `<th scope="row">`. Full APG-conformant table
 *   role hierarchy — supports navigation-by-header in AT.
 * - **Broken:** `<div>` grid with visually-styled headers. AT sees a
 *   generic block; header/cell relationships are invisible.
 */
const meta: Meta<typeof DataTableCorrect> = {
  title: "Content Patterns/Data Table",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof DataTableCorrect>;

const columns = [
  { id: "name", label: "Name" },
  { id: "role", label: "Role" },
  { id: "team", label: "Team" },
];
const rows = [
  {
    id: "1",
    cells: { name: "Ada Lovelace", role: "Engineer", team: "Platform" },
  },
  {
    id: "2",
    cells: { name: "Grace Hopper", role: "Manager", team: "Runtime" },
  },
  { id: "3", cells: { name: "Alan Turing", role: "Engineer", team: "Codec" } },
];

export const Correct: Story = {
  render: () => (
    <DataTableCorrect caption="Team roster" columns={columns} rows={rows} />
  ),
};

export const Broken: Story = {
  render: () => (
    <DataTableBroken caption="Team roster" columns={columns} rows={rows} />
  ),
};
