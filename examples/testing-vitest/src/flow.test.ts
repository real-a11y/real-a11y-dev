import { describe, it, expect, afterEach } from "vitest";

import { findByRole, flow } from "@real-a11y-dev/testing";

import { fixture, cleanup } from "./fixtures.js";

afterEach(cleanup);

/**
 * `flow()` chains an interaction against the live tree and asserts about
 * the post-interaction state. Each step re-extracts the tree so dialogs,
 * options, and other dynamically-mounted nodes are visible to later steps.
 */
describe("flow — interaction chains", () => {
  it("clicks a native <select> and reads the chosen value", async () => {
    const root = fixture(`
      <main>
        <h1>Shipping</h1>
        <label>
          Country
          <select>
            <option value="">--</option>
            <option value="es">Spain</option>
            <option value="pt">Portugal</option>
          </select>
        </label>
      </main>
    `);

    await flow(root)
      .findByRole("combobox", { name: "Country" })
      .select("es")
      .expect((tree) => {
        const combo = findByRole(tree, "combobox", { name: "Country" });
        expect(combo).toBeDefined();
      });

    // The dispatched select action mutates the underlying <select>.
    expect(root.querySelector("select")!.value).toBe("es");
  });

  it("opens a dialog and asserts its accessible name via expectActiveModal", async () => {
    const root = fixture(`
      <main>
        <h1>Account</h1>
        <button id="del">Delete account</button>
      </main>
    `);
    const main = root.querySelector("main")!;

    // Real apps will typically render this through React/Vue/etc.; for the
    // example we wire a plain click handler so the test doesn't need a
    // framework.
    root.querySelector("#del")!.addEventListener("click", () => {
      const dlg = document.createElement("div");
      dlg.setAttribute("role", "dialog");
      dlg.setAttribute("aria-label", "Confirm delete");
      dlg.innerHTML = `
        <p>This cannot be undone.</p>
        <button id="cancel">Cancel</button>
        <button id="confirm">Delete</button>
      `;
      main.appendChild(dlg);

      // Dismiss handler so the next step can observe the dialog closing.
      dlg.querySelector("#cancel")!.addEventListener("click", () => {
        dlg.remove();
      });
    });

    await flow(root)
      .findByRole("button", { name: "Delete account" })
      .click()
      // Predicate API: passes if a dialog is open *and* its name matches.
      .expectActiveModal((name) => /confirm/i.test(name))
      .findByRole("button", { name: "Cancel" })
      .click()
      // null asserts no dialog is open at this point.
      .expectActiveModal(null);
  });

  it("toggles a <details> disclosure", async () => {
    const root = fixture(`
      <main>
        <details>
          <summary>Payment options</summary>
          <p>Card, PayPal, bank transfer.</p>
        </details>
      </main>
    `);
    const details = root.querySelector("details") as HTMLDetailsElement;

    expect(details.open).toBe(false);
    await flow(root).findByRole("group", { name: "Payment options" }).toggle();
    expect(details.open).toBe(true);
  });

  it("submits a form via the submit() action", async () => {
    const root = fixture(`
      <main>
        <form aria-label="Newsletter">
          <label>Email<input type="email" required /></label>
          <button type="submit">Subscribe</button>
        </form>
      </main>
    `);
    let submitted = false;
    root.querySelector("form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      submitted = true;
    });

    await flow(root)
      .findByRole("textbox", { name: "Email" })
      .type("ada@example.com")
      .findByRole("button", { name: "Subscribe" })
      .submit();

    expect(submitted).toBe(true);
    expect(root.querySelector("input")!.value).toBe("ada@example.com");
  });
});
