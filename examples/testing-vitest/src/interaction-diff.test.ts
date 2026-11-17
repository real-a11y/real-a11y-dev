// Snapshotting what an interaction changes: `capture()` the tree before,
// act, then snapshot `a11yDiff(before, root)` — the rows added, removed and
// changed, and where focus went. Run with REAL_A11Y_TREES_DIR set and the
// snapshot viewer (`packages/snapshot-viewer`) draws each of these with the
// Semantic Navigator panel, changes marked.
import { afterEach, describe, expect, it } from "vitest";

import { a11yDiff, capture } from "@real-a11y-dev/testing";
import { boxedTreeSnapshot } from "@real-a11y-dev/testing/matchers";

afterEach(() => {
  document.body.innerHTML = "";
});

function renderBookingForm(): HTMLElement {
  document.body.innerHTML = `
    <main>
      <h1>Book a move</h1>
      <dl>
        <dt>Service</dt><dd>Local move</dd>
        <dt>Hours</dt><dd>Mon–Sat 8:00–18:00</dd>
      </dl>
      <form aria-label="Booking" novalidate>
        <label for="pickup">Pickup address</label>
        <input id="pickup" autocomplete="street-address" />
        <label for="postcode">Pickup postcode</label>
        <input id="postcode" inputmode="numeric" aria-describedby="postcode-hint" />
        <p id="postcode-hint">5 digits. We use it to check we cover your area.</p>
        <label for="date">Date</label>
        <input id="date" type="date" />
        <div role="status" id="date-status"></div>
        <label for="time">Time</label>
        <select id="time">
          <option>09:00</option>
          <option>12:00</option>
          <option>15:00</option>
        </select>
        <button type="submit">Request move</button>
      </form>
      <a href="/signup">Create an account</a>
    </main>`;
  return document.querySelector("main")!;
}

describe("booking form", () => {
  it("exposes headings, labeled fields and the submit button", () => {
    const root = renderBookingForm();
    expect(boxedTreeSnapshot(root)).toMatchSnapshot();
  });

  it("announces a closed day in a status message", () => {
    const root = renderBookingForm();
    const before = capture(root);

    document.getElementById("date-status")!.textContent =
      "We're closed that day. Pick another date.";
    document.getElementById("date")!.focus();

    expect(a11yDiff(before, root)).toMatchSnapshot();
  });

  it("announces a refused pickup above the form and moves focus there", () => {
    const root = renderBookingForm();
    document.getElementById("time")!.focus();
    const before = capture(root);

    const form = root.querySelector("form")!;
    form.insertAdjacentHTML(
      "beforebegin",
      `<div role="alert" tabindex="-1" id="error-summary">
         <p>We couldn't send your request</p>
         <p>We don't serve this pickup postcode. Check it is correct.</p>
       </div>`,
    );
    const postcode = document.getElementById("postcode")!;
    postcode.setAttribute("aria-invalid", "true");
    postcode.setAttribute("aria-describedby", "postcode-hint postcode-error");
    document
      .getElementById("postcode-hint")!
      .insertAdjacentHTML(
        "afterend",
        `<p id="postcode-error">We don't serve this postcode.</p>`,
      );
    document.getElementById("error-summary")!.focus();

    expect(a11yDiff(before, root)).toMatchSnapshot();
  });
});
