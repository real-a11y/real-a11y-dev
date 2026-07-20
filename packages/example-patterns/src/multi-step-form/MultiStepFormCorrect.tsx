import { useId, useState } from "react";

import type { MultiStepFormExampleProps } from "./types.js";

// Correct multi-step form. Assembles three overlapping WAI-ARIA
// affordances:
//
//   1. Progress indicator — <ol aria-label="Progress"> with each
//      step as <li>. The active step gets `aria-current="step"`
//      (announced as "current step").
//
//   2. Per-step semantics — each step's fields live inside
//      <fieldset><legend>{step.label}</legend> so screen readers
//      announce the step name when landing on any field within.
//
//   3. Validation — invalid fields get `aria-invalid="true"` and
//      `aria-describedby` pointing at a `role="alert"` message
//      element. A screen reader hears the error inline with the
//      field, and the alert region announces new errors as soon as
//      they appear.
//
// The demo hard-codes a "field required" validation on the first
// step's email input to show the alert / describedby wiring.
export function MultiStepFormCorrect({
  steps,
  initialStepIndex = 0,
}: MultiStepFormExampleProps) {
  const [current, setCurrent] = useState(initialStepIndex);
  const [email, setEmail] = useState("");
  const [attemptedNext, setAttemptedNext] = useState(false);
  const emailInvalid = attemptedNext && email.trim() === "" && current === 0;

  const emailId = useId();
  const emailErrorId = useId();

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
      <ol
        aria-label="Progress"
        style={{
          display: "flex",
          gap: 12,
          listStyle: "none",
          padding: 0,
          margin: 0,
        }}
      >
        {steps.map((s, i) => {
          const isCurrent = i === current;
          const isDone = i < current;
          return (
            <li
              key={s.id}
              aria-current={isCurrent ? "step" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: isCurrent ? "var(--vp-c-text-1, #222)" : "#888",
                fontWeight: isCurrent ? 700 : 400,
              }}
            >
              <span
                aria-hidden="true"
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
            </li>
          );
        })}
      </ol>

      <fieldset
        style={{
          border: "1px solid var(--vp-c-border, #ccc)",
          borderRadius: 6,
          padding: 16,
        }}
      >
        <legend style={{ padding: "0 6px", fontWeight: 600 }}>
          {steps[current]?.label}
        </legend>

        {current === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor={emailId} style={{ font: "inherit" }}>
              Email address
            </label>
            <input
              id={emailId}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={emailInvalid || undefined}
              aria-describedby={emailInvalid ? emailErrorId : undefined}
              style={{
                padding: "6px 10px",
                border: `1px solid ${emailInvalid ? "#c53030" : "var(--vp-c-border, #ccc)"}`,
                borderRadius: 6,
                font: "inherit",
              }}
            />
            {emailInvalid ? (
              <div
                id={emailErrorId}
                role="alert"
                style={{ color: "#c53030", fontSize: 13 }}
              >
                Email address is required.
              </div>
            ) : null}
          </div>
        ) : (
          <p style={{ color: "#666" }}>
            (Placeholder body for the &ldquo;{steps[current]?.label}&rdquo;
            step.)
          </p>
        )}
      </fieldset>

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
