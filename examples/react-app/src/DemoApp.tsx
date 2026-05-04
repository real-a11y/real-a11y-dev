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

        {/* Section 4 — Code blocks, decorative tokens via role="presentation" */}
        <section
          aria-labelledby="codeblocks-heading"
          style={{ marginBottom: 40 }}
        >
          <h2 id="codeblocks-heading">Code blocks — decorative tokens</h2>
          <p style={{ color: "#666", marginBottom: 16 }}>
            Two snippets with identical token spans. The first leaves the spans
            unstyled, so each token shows up as a separate <code>generic</code>{" "}
            node in the accessibility tree. The second sets{" "}
            <code>role="presentation"</code> on each span — the browser drops
            them and the whole <code>&lt;pre&gt;</code> reads as a single
            accessible code block. Open Chrome DevTools' Accessibility panel (or
            the Real A11y panel after 0.1.0-beta.5 ships the extractor fix) to
            see the difference.
          </p>
          <CodeBlockDemo />
        </section>

        {/* Section 5 — aria-hidden decorative graphics inside named ancestors */}
        <section aria-labelledby="aria-hidden-heading">
          <h2 id="aria-hidden-heading">
            Icon links — <code>aria-hidden</code> decorative graphics
          </h2>
          <p style={{ color: "#666", marginBottom: 16 }}>
            Decorative SVGs sit inside a named link or button. The SVG carries{" "}
            <code>aria-hidden="true"</code> so its text content is excluded from
            the accessible name. Per WAI-ARIA accname-1.2 §4.3.2 step 2A, hidden
            subtrees contribute the empty string — the link should announce as{" "}
            <em>"Real A11y — go to home"</em>, not{" "}
            <em>"real a11y Real A11y — go to home"</em>. Watch the panel's{" "}
            <code>name</code> column.
          </p>
          <AriaHiddenIconDemo />
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

/**
 * Two `<pre><code>` blocks with the same token spans. The "noisy" one has no
 * role on the spans, so each token is its own `generic` node in the a11y
 * tree. The "decorative" one sets `role="presentation"` on each span — per
 * the ARIA spec the element is then dropped from the tree and its text
 * content rolls up into the parent `<pre>`.
 */
function CodeBlockDemo() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <p style={codeLabelStyle}>Noisy — token spans without a role</p>
        <pre tabIndex={0} style={codeBlockStyle}>
          <code>
            <span style={tokenKw}>const</span> <span style={tokenVar}>sn</span>{" "}
            = <span style={tokenFn}>createInspector</span>({"{"} root, container{" "}
            {"}"});{"\n"}
            <span style={tokenVar}>sn</span>.<span style={tokenFn}>mount</span>
            ();
          </code>
        </pre>
      </div>
      <div>
        <p style={codeLabelStyle}>
          Decorative tokens — <code>role="presentation"</code>
        </p>
        <pre tabIndex={0} style={codeBlockStyle}>
          <code>
            <span role="presentation" style={tokenKw}>
              const
            </span>{" "}
            <span role="presentation" style={tokenVar}>
              sn
            </span>{" "}
            ={" "}
            <span role="presentation" style={tokenFn}>
              createInspector
            </span>
            ({"{"} root, container {"}"});{"\n"}
            <span role="presentation" style={tokenVar}>
              sn
            </span>
            .
            <span role="presentation" style={tokenFn}>
              mount
            </span>
            ();
          </code>
        </pre>
      </div>
    </div>
  );
}

/**
 * Three accessible-name patterns where a decorative SVG / icon sits next to
 * the real label. The SVG is `aria-hidden="true"`, so its text content is
 * skipped in name-from-content. Open the inspector panel and check the
 * `name` column on each — the decorative glyph never appears in the name.
 */
function AriaHiddenIconDemo() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 1. Logo link — aria-label override + aria-hidden SVG wordmark */}
      <a
        href="#"
        aria-label="Real A11y — go to home"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          width: "fit-content",
          textDecoration: "none",
          color: "#111",
        }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 100 24"
          width="100"
          height="24"
          style={{ display: "block" }}
        >
          <text
            x="0"
            y="18"
            fontFamily="ui-monospace, monospace"
            fontSize="18"
            fontWeight="700"
          >
            real a11y
          </text>
        </svg>
      </a>

      {/* 2. Icon-only button — sr-only label + aria-hidden glyph */}
      <button
        type="button"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          width: "fit-content",
          padding: "6px 10px",
          border: "1px solid #ccc",
          borderRadius: 6,
          background: "#fff",
          cursor: "pointer",
        }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          style={{ display: "block" }}
        >
          <path
            d="M8 1.5L15 14.5H1z"
            fill="#d97706"
            stroke="#92400e"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          <text
            x="6"
            y="13"
            fontFamily="ui-monospace, monospace"
            fontSize="9"
            fill="#fff"
          >
            !
          </text>
        </svg>
        <span style={srOnlyStyle}>Show warnings</span>
      </button>

      {/* 3. Status badge link — aria-hidden dot, real label */}
      <a
        href="#"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          width: "fit-content",
          color: "#0050b3",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#d97706",
          }}
        />
        <span>Status: degraded</span>
      </a>
    </div>
  );
}

const srOnlyStyle: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const codeLabelStyle: React.CSSProperties = {
  fontWeight: 600,
  marginBottom: 4,
  color: "#444",
  fontSize: "0.95rem",
};

const codeBlockStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #ddd",
  borderRadius: 6,
  padding: 12,
  overflowX: "auto",
  margin: 0,
  font: "13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
};

const tokenKw: React.CSSProperties = { color: "#d73a49" };
const tokenVar: React.CSSProperties = { color: "#005cc5" };
const tokenFn: React.CSSProperties = { color: "#6f42c1" };

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
