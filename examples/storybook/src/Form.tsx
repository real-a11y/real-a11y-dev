import { useState } from "react";

export interface FormProps {
  /** Include an intentionally unlabeled field to demonstrate the panel catching it */
  includeUnlabeledField?: boolean;
}

export function Form({ includeUnlabeledField = false }: FormProps) {
  const [submitted, setSubmitted] = useState(false);

  return (
    <form
      aria-label="Contact form"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 360,
      }}
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
      }}
    >
      <h2 style={{ marginBottom: 8 }}>Contact us</h2>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        Full name
        <input type="text" autoComplete="name" style={inputStyle} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        Email address
        <input type="email" autoComplete="email" style={inputStyle} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        Message
        <textarea rows={4} style={{ ...inputStyle, resize: "vertical" }} />
      </label>

      {includeUnlabeledField && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {/* No <label> — will appear as "unlabeled textbox" in the panel */}
          <input
            type="text"
            placeholder="No label (intentional)"
            style={inputStyle}
          />
        </div>
      )}

      {submitted ? (
        <p role="status" style={{ color: "green" }}>
          ✓ Message sent!
        </p>
      ) : (
        <button type="submit" style={btnStyle}>
          Send message
        </button>
      )}
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #ccc",
  borderRadius: 4,
  font: "inherit",
};

const btnStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "#2e79ff",
  color: "white",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  font: "inherit",
};
