import { useState } from "react";

import type { MultiStepFormExampleProps } from "./types.js";

// Hand-rolled "broken" multi-step form. Deliberately wrong on three
// axes that overlap in form flows:
//
//   1. Progress indicator uses <div>s with NO aria-current="step" —
//      AT users can't tell which step they're on.
//
//   2. Each step's fields are wrapped in a plain <div> with NO
//      <fieldset>/<legend>, so screen readers don't announce the
//      step name when landing on a field.
//
//   3. Validation error is a plain <p> disconnected from the input.
//      No `aria-invalid`, no `aria-describedby`, no `role="alert"` —
//      the error only exists visually (red text). Screen reader
//      users hear "Email, edit" and never learn why the form
//      wouldn't advance.
//
// Visually identical to the correct variant.
export function MultiStepFormBroken({
  steps,
  initialStepIndex = 0,
}: MultiStepFormExampleProps) {
  const [current, setCurrent] = useState(initialStepIndex);
  const [email, setEmail] = useState("");
  const [attemptedNext, setAttemptedNext] = useState(false);
  const showEmailError = attemptedNext && email.trim() === "" && current === 0;

  const goNext = () => {
    if (current === 0 && email.trim() === "") {
      setAttemptedNext(true);
      return;
    }
    setAttemptedNext(false);
    setCurrent((c) => Math.min(c + 1, steps.length - 1));
  };
  const goPrev = () => setCurrent((c) => Math.max(c - 1, 0));

  return (
    <form
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 420,
      }}
      onSubmit={(e) => e.preventDefault()}
    >
      <div style={{ display: "flex", gap: 12 }}>
        {steps.map((s, i) => {
          const isCurrent = i === current;
          const isDone = i < current;
          return (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: isCurrent ? "var(--vp-c-text-1, #222)" : "#888",
                fontWeight: isCurrent ? 700 : 400,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  border: `1px solid ${isCurrent || isDone ? "var(--vp-c-brand, #2e79ff)" : "var(--vp-c-border, #ccc)"}`,
                  background: isDone
                    ? "var(--vp-c-brand, #2e79ff)"
                    : "transparent",
                  color: isDone ? "#fff" : "inherit",
                  fontSize: 12,
                }}
              >
                {isDone ? "✓" : i + 1}
              </span>
              {s.label}
            </div>
          );
        })}
      </div>

      <div
        style={{
          border: "1px solid var(--vp-c-border, #ccc)",
          borderRadius: 6,
          padding: 16,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          {steps[current]?.label}
        </div>

        {current === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control --
                Intentional — this variant is broken by construction.
                The label is a floating <label> with no htmlFor / no
                wrapping input; the paired input has no id. Exactly the
                a11y failure this "broken" sibling is meant to model. */}
            <label style={{ font: "inherit" }}>Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                padding: "6px 10px",
                border: `1px solid ${showEmailError ? "#c53030" : "var(--vp-c-border, #ccc)"}`,
                borderRadius: 6,
                font: "inherit",
              }}
            />
            {showEmailError ? (
              <p style={{ color: "#c53030", fontSize: 13, margin: 0 }}>
                Email address is required.
              </p>
            ) : null}
          </div>
        ) : (
          <p style={{ color: "#666" }}>
            (Placeholder body for the &ldquo;{steps[current]?.label}&rdquo;
            step.)
          </p>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button
          type="button"
          onClick={goPrev}
          disabled={current === 0}
          style={{
            padding: "6px 12px",
            border: "1px solid var(--vp-c-border, #ccc)",
            borderRadius: 6,
            background: "transparent",
            cursor: current === 0 ? "not-allowed" : "pointer",
            font: "inherit",
            opacity: current === 0 ? 0.5 : 1,
          }}
        >
          Back
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={current === steps.length - 1}
          style={{
            padding: "6px 12px",
            border: "1px solid var(--vp-c-brand, #2e79ff)",
            borderRadius: 6,
            background: "var(--vp-c-brand, #2e79ff)",
            color: "#fff",
            cursor: current === steps.length - 1 ? "not-allowed" : "pointer",
            font: "inherit",
            opacity: current === steps.length - 1 ? 0.5 : 1,
          }}
        >
          {current === steps.length - 1 ? "Submit" : "Next"}
        </button>
      </div>
    </form>
  );
}
