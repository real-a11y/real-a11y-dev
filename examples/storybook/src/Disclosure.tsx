import { useState } from "react";

/**
 * Two disclosure triggers:
 * - The first is wired with explicit `aria-controls` → solid cross-link chip
 *   in the Semantic Navigator panel.
 * - The second declares `aria-haspopup` only → dashed (inferred) chip when
 *   the menu is currently open.
 */
export function Disclosure() {
  const [explicitOpen, setExplicitOpen] = useState(false);
  const [inferredOpen, setInferredOpen] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2>Disclosure widgets</h2>
      <p style={{ color: "#555", maxWidth: 480 }}>
        Open either menu and look at the Semantic Navigator panel. The trigger
        row shows a <code>→ menu</code> chip; the menu row shows a{" "}
        <code>← button</code> chip. Solid border = explicit{" "}
        <code>aria-controls</code>. Dashed border = inferred from{" "}
        <code>aria-haspopup</code> + <code>aria-expanded</code>.
      </p>

      <div>
        <button
          type="button"
          aria-haspopup="menu"
          aria-controls="settings-menu"
          aria-expanded={explicitOpen}
          onClick={() => setExplicitOpen((v) => !v)}
          style={btnStyle}
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
          style={btnStyle}
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

const btnStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "#2e79ff",
  color: "white",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  font: "inherit",
  alignSelf: "flex-start",
};

const menuStyle: React.CSSProperties = {
  marginTop: 8,
  border: "1px solid #ccc",
  borderRadius: 6,
  padding: 8,
  background: "#fff",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  maxWidth: 240,
};
