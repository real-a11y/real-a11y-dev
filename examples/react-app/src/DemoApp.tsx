import { useRef, useState } from "react";

/**
 * A realistic-looking mini app with:
 * - Heading structure (h1 > h2 > h2)
 * - A form with proper labels
 * - An intentional missing label (to demonstrate IssuesBadge)
 * - A dialog
 * - Navigation landmarks
 */
export function DemoApp() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  function openDialog() {
    setDialogOpen(true);
    // Use requestAnimationFrame so the dialog is in the DOM before showModal
    requestAnimationFrame(() => dialogRef.current?.showModal());
  }

  function closeDialog() {
    dialogRef.current?.close();
    setDialogOpen(false);
  }

  return (
    <>
      <nav aria-label="Site navigation" style={{ marginBottom: 32 }}>
        <ul style={{ listStyle: "none", display: "flex", gap: 20, padding: 0 }}>
          <li>
            <a href="#">Home</a>
          </li>
          <li>
            <a href="#">Products</a>
          </li>
          <li>
            <a href="#">Pricing</a>
          </li>
          <li>
            <a href="#">Contact</a>
          </li>
        </ul>
      </nav>

      <main>
        <h1>Account settings</h1>
        <p style={{ color: "#666", marginBottom: 32 }}>
          Manage your profile and preferences.
        </p>

        {/* Section 1 — Profile */}
        <section aria-labelledby="profile-heading" style={{ marginBottom: 40 }}>
          <h2 id="profile-heading">Profile information</h2>
          <form
            aria-label="Profile form"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              maxWidth: 400,
            }}
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(true);
            }}
          >
            <label style={labelStyle}>
              Full name
              <input type="text" autoComplete="name" style={inputStyle} />
            </label>

            <label style={labelStyle}>
              Email address
              <input type="email" autoComplete="email" style={inputStyle} />
            </label>

            {/* Intentionally unlabeled — IssuesBadge should catch this */}
            <div style={labelStyle}>
              <span aria-hidden="true">
                Timezone (unlabeled — intentional demo)
              </span>
              <select style={inputStyle}>
                <option>UTC</option>
                <option>Europe/Madrid</option>
                <option>America/Mexico_City</option>
              </select>
            </div>

            {submitted && (
              <p role="status" style={{ color: "green" }}>
                ✓ Settings saved
              </p>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" style={primaryBtnStyle}>
                Save changes
              </button>
              <button
                type="button"
                onClick={openDialog}
                style={secondaryBtnStyle}
              >
                Delete account
              </button>
            </div>
          </form>
        </section>

        {/* Section 2 — Notifications */}
        <section aria-labelledby="notif-heading">
          <h2 id="notif-heading">Notifications</h2>
          <fieldset
            style={{ border: "1px solid #ddd", borderRadius: 6, padding: 16 }}
          >
            <legend>Email preferences</legend>
            <label
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <input type="checkbox" defaultChecked />
              Product updates
            </label>
            <label
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <input type="checkbox" />
              Security alerts
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" defaultChecked />
              Weekly digest
            </label>
          </fieldset>
        </section>

        {/* Section 3 — Disclosure widgets, drives the cross-link chips */}
        <section
          aria-labelledby="disclosure-heading"
          style={{ marginBottom: 40 }}
        >
          <h2 id="disclosure-heading">Disclosure widgets</h2>
          <p style={{ color: "#666", marginBottom: 16 }}>
            Open either menu and look for the <strong>→ menu</strong> chip on
            the trigger row in the panel and the <strong>← button</strong> chip
            on the menu row. Click either to jump.
          </p>
          <DisclosureDemo />
        </section>
      </main>

      {/* Confirmation dialog */}
      <dialog
        ref={dialogRef}
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
        style={{
          borderRadius: 8,
          border: "none",
          padding: 24,
          maxWidth: 400,
          width: "90%",
        }}
        onClose={closeDialog}
      >
        <h2 id="confirm-title" style={{ marginBottom: 8 }}>
          Delete account?
        </h2>
        <p id="confirm-desc" style={{ color: "#555", marginBottom: 24 }}>
          This action cannot be undone. All your data will be permanently
          deleted.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={closeDialog} style={secondaryBtnStyle}>
            Cancel
          </button>
          <button
            type="button"
            onClick={closeDialog}
            style={{
              ...primaryBtnStyle,
              background: "#d00",
              borderColor: "#d00",
            }}
          >
            Yes, delete my account
          </button>
        </div>
      </dialog>
    </>
  );
}

/**
 * Two disclosure triggers — one wired with `aria-controls`, one with only
 * `aria-haspopup`. The Real A11y panel renders the explicit one with a solid
 * chip and the heuristic one with a dashed (inferred) chip.
 */
function DisclosureDemo() {
  const [explicitOpen, setExplicitOpen] = useState(false);
  const [inferredOpen, setInferredOpen] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <button
          type="button"
          aria-haspopup="menu"
          aria-controls="settings-menu"
          aria-expanded={explicitOpen}
          onClick={() => setExplicitOpen((v) => !v)}
          style={secondaryBtnStyle}
        >
          {explicitOpen ? "Close" : "Open"} settings (aria-controls)
        </button>
        {explicitOpen && (
          <div
            id="settings-menu"
            role="menu"
            aria-label="Settings menu"
            style={menuStyle}
          >
            <div role="menuitem" tabIndex={-1}>
              Account
            </div>
            <div role="menuitem" tabIndex={-1}>
              Notifications
            </div>
            <div role="menuitem" tabIndex={-1}>
              Sign out
            </div>
          </div>
        )}
      </div>
      <div>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={inferredOpen}
          onClick={() => setInferredOpen((v) => !v)}
          style={secondaryBtnStyle}
        >
          {inferredOpen ? "Close" : "Open"} profile (no aria-controls)
        </button>
        {inferredOpen && (
          <div role="menu" aria-label="Profile menu" style={menuStyle}>
            <div role="menuitem" tabIndex={-1}>
              View profile
            </div>
            <div role="menuitem" tabIndex={-1}>
              Edit profile
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const menuStyle: React.CSSProperties = {
  marginTop: 8,
  border: "1px solid #ccc",
  borderRadius: 6,
  padding: 8,
  background: "#fff",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #ccc",
  borderRadius: 4,
  font: "inherit",
  fontSize: "1rem",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "#2e79ff",
  color: "white",
  border: "1px solid #2e79ff",
  borderRadius: 4,
  cursor: "pointer",
  font: "inherit",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "transparent",
  color: "#333",
  border: "1px solid #ccc",
  borderRadius: 4,
  cursor: "pointer",
  font: "inherit",
};
