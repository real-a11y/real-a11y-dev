import * as React from "react";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { recordTimeline } from "@real-a11y-dev/testing";
import { ToastCorrect } from "@real-a11y-dev/example-patterns";

afterEach(cleanup);

/** Resolves on the next task, as a request the page waits on would. */
const request = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * A list of drafts whose delete button removes its own row. `focusAfter`
 * decides whether the page moves focus once the row is gone, or leaves it
 * wherever the removal dropped it.
 */
function Drafts({ focusAfter }: { focusAfter: boolean }) {
  const [drafts, setDrafts] = React.useState(["Q3 plan"]);
  const [status, setStatus] = React.useState("");
  const newDraft = React.useRef<HTMLButtonElement>(null);

  async function remove(title: string) {
    setStatus("Deleting…");
    await request();
    setDrafts((all) => all.filter((d) => d !== title));
    setStatus("");
    await request();
    setStatus(`${title} deleted.`);
    if (focusAfter) newDraft.current?.focus();
  }

  return (
    <main>
      <p role="status">{status}</p>
      <ul>
        {drafts.map((title) => (
          <li key={title}>
            {title}{" "}
            <button onClick={() => remove(title)}>Delete {title}</button>
          </li>
        ))}
      </ul>
      <button ref={newDraft}>New draft</button>
    </main>
  );
}

async function deleteDraft(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Delete Q3 plan" }));
  await screen.findByText("Q3 plan deleted.");
}

describe("recordTimeline — what a delete button does to focus", () => {
  it("moves focus on once its row is gone", async () => {
    render(<Drafts focusAfter />);
    screen.getByRole("button", { name: "Delete Q3 plan" }).focus();
    const timeline = recordTimeline(document.body);

    await deleteDraft();

    // Focus drops to the page for a moment: a screen reader announces the
    // document there. And `focus()` runs at once while React renders the
    // status later, so focus lands on "New draft" before the message
    // arrives — the order a diff of the two ends can't show.
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "Delete Q3 plan"
      announce  status "Deleting…"
      focus     (none)
      focus     button "New draft"
      announce  status "Q3 plan deleted."
    `);
  });

  it("leaves focus on the page when nothing moves it", async () => {
    render(<Drafts focusAfter={false} />);
    screen.getByRole("button", { name: "Delete Q3 plan" }).focus();
    const timeline = recordTimeline(document.body, { announcements: false });

    await deleteDraft();

    // The focus-only view: the drop to the page is the last thing the
    // keyboard user meets. Their next Tab starts from the top.
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "Delete Q3 plan"
      focus     (none)
    `);
  });
});

describe("recordTimeline — a portaled toast", () => {
  it("hears a status region that portals to the body", async () => {
    render(
      <ToastCorrect
        trigger="Save"
        title="Saved"
        description="Your changes are stored."
      />,
    );
    const save = screen.getByText("Save");
    save.focus();
    const timeline = recordTimeline(document.body);
    fireEvent.click(save);
    // Radix announces through a region of its own, filled a frame later.
    await screen.findByText(/^Notification/);

    // Focus stays put, and the toast is announced assertively.
    expect(timeline.stop()).toMatchInlineSnapshot(`
      focus     button "Save"
      announce  status "Notification SavedYour changes are stored." {live=assertive}
    `);
  });
});
