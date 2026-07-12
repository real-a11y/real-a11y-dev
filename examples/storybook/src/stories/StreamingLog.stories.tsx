import * as React from "react";

import type { Meta, StoryObj } from "@storybook/react";

/**
 * Live region / streaming content — exercises the Semantic Navigator panel's
 * "updates live" promise.
 *
 * Clicking **Stream response** appends tokens to a `role="log"` region every
 * 120ms — faster than the panel observer's debounce, and the DOM never goes
 * quiet until the stream ends. The max-wait ceiling in `@real-a11y-dev/core`
 * keeps the tree panel refreshing *during* the stream instead of freezing on
 * the trigger's pre-stream state until it stops. Open the Semantic Navigator
 * panel and watch the `log` fill in while it streams.
 *
 * The stream is bounded (one sentence, then it stops) so the story doesn't
 * churn the CPU forever.
 */
function StreamingResponse(): React.ReactElement {
  const words = React.useMemo(
    () =>
      (
        "Streaming the assistant response one token at a time so the live " +
        "tree keeps refreshing while the DOM never goes quiet"
      ).split(" "),
    [],
  );
  const [text, setText] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = React.useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  // Clear the interval if the story unmounts mid-stream.
  React.useEffect(() => stop, [stop]);

  const start = () => {
    stop();
    setText("");
    setStreaming(true);
    let i = 0;
    timer.current = setInterval(() => {
      setText((t) => (t ? `${t} ${words[i]}` : words[i]));
      i += 1;
      if (i >= words.length) {
        stop();
        setStreaming(false);
      }
    }, 120);
  };

  return (
    <section
      aria-label="Assistant"
      style={{
        display: "grid",
        gap: 12,
        maxWidth: 480,
        font: "16px system-ui",
      }}
    >
      <button type="button" onClick={start} disabled={streaming}>
        {streaming ? "Streaming…" : "Stream response"}
      </button>
      <div
        role="log"
        aria-live="polite"
        aria-label="Assistant response"
        style={{
          minHeight: 96,
          padding: 12,
          border: "1px solid #cbd5e1",
          borderRadius: 8,
          lineHeight: 1.5,
        }}
      >
        {text}
      </div>
    </section>
  );
}

const meta: Meta<typeof StreamingResponse> = {
  title: "Live regions/Streaming response",
  component: StreamingResponse,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof StreamingResponse>;

export const Default: Story = {};
