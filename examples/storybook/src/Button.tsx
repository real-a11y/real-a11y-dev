import type { CSSProperties, MouseEventHandler } from "react";

export interface ButtonProps {
  /** Button label */
  label: string;
  /** Visual variant */
  variant?: "primary" | "secondary" | "danger";
  /** Disables the button */
  disabled?: boolean;
  /** Click handler */
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

const styles: Record<string, CSSProperties> = {
  primary: {
    background: "#2e79ff",
    color: "white",
    border: "1px solid #2e79ff",
  },
  secondary: {
    background: "transparent",
    color: "#333",
    border: "1px solid #ccc",
  },
  danger: {
    background: "#d00",
    color: "white",
    border: "1px solid #d00",
  },
};

export function Button({
  label,
  variant = "primary",
  disabled = false,
  onClick,
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: "8px 18px",
        borderRadius: 4,
        cursor: disabled ? "not-allowed" : "pointer",
        font: "inherit",
        fontSize: "1rem",
        opacity: disabled ? 0.5 : 1,
        ...styles[variant],
      }}
    >
      {label}
    </button>
  );
}
