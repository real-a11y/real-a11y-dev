import type { Meta, StoryObj } from "@storybook/react";

import { QuillEditor } from "../QuillEditor.js";

/**
 * A real Quill editor. Quill (like Slack, which is built on it) renders its
 * editable surface as a `contenteditable` `<div class="ql-editor">` — a
 * model-driven rich editor rather than a native `<input>`. Open the Semantic
 * Navigator panel to see it extracted as a named, editable `textbox`.
 */
const meta: Meta<typeof QuillEditor> = {
  title: "Rich text/Quill editor",
  component: QuillEditor,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof QuillEditor>;

export const MessageComposer: Story = {};
