import { useRef, useState } from "react";
import { SemanticNavigator } from "@real-a11y-dev/react";
import { DemoApp } from "./DemoApp.js";
import { IssuesBadge } from "./IssuesBadge.js";
import { ModalAnnouncer } from "./ModalAnnouncer.js";

export function App() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"a11y" | "dom">("a11y");
  const [panelVisible, setPanelVisible] = useState(true);

  return (
    <div
      ref={rootRef}
      style={{
        minHeight: "100vh",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 16px",
          borderBottom: "1px solid #eee",
          background: "#fff",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <strong style={{ marginRight: "auto" }}>Real A11y — React example</strong>
        <IssuesBadge rootRef={rootRef} />
        <button
          type="button"
          onClick={() => setMode((m) => (m === "a11y" ? "dom" : "a11y"))}
          style={btnStyle}
        >
          {mode === "a11y" ? "A11y" : "DOM"} mode
        </button>
        <button
          type="button"
          onClick={() => setPanelVisible((v) => !v)}
          style={btnStyle}
        >
          {panelVisible ? "Hide" : "Show"} panel
        </button>
      </div>

      {/* Content — full width, panel floats over it */}
      <div style={{ padding: "24px 32px", maxWidth: 820, margin: "0 auto" }}>
        <DemoApp />
      </div>

      {/* Screen-reader announcer */}
      <ModalAnnouncer rootRef={rootRef} />

      {/* Floating Semantic Navigator — rendered into document.body via portal */}
      {panelVisible && (
        <SemanticNavigator
          root={rootRef}
          mode={mode}
          floating
          highlightOnHover
          panelTitle="Semantic Navigator"
        />
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "4px 12px",
  border: "1px solid #2e79ff",
  background: "rgba(46,121,255,0.08)",
  borderRadius: 4,
  cursor: "pointer",
  font: "inherit",
  color: "#2e79ff",
};
