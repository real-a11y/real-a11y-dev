import { applyStyle, styles } from "../_shared.js";

// Hand-rolled "broken" Tabs. Deliberately wrong on the role chain:
//
//   1. NO role="tablist" / "tab" / "tabpanel". The container reads as
//      a generic group of buttons; AT users can't tell this is a tabbed
//      widget.
//
//   2. NO aria-selected, NO aria-controls. Active state is conveyed via
//      bold styling only.
//
//   3. NO roving tabindex. Every tab button stays in the tab sequence
//      (Tab moves through them all instead of arrows nav within one stop).
//
// Visually identical to the correct variant — same borders, same active
// indicator — just no AT signal.
export function mountTabsBroken(host: HTMLElement): void {
  const tabs = [
    {
      id: "overview",
      label: "Overview",
      body: "Project overview and summary.",
    },
    { id: "specs", label: "Specs", body: "Technical specifications and APIs." },
    { id: "faq", label: "FAQ", body: "Frequently asked questions." },
  ];

  const root = document.createElement("div");
  applyStyle(root, {
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    background: styles.bg,
    overflow: "hidden",
  });

  const triggerRow = document.createElement("div");
  applyStyle(triggerRow, {
    display: "flex",
    borderBottom: `1px solid ${styles.border}`,
  });

  const panels: HTMLElement[] = [];
  const triggers: HTMLButtonElement[] = [];
  let activeIndex = 0;

  tabs.forEach((tab, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = tab.label;
    applyStyle(btn, {
      flex: "1",
      padding: "8px 12px",
      border: "none",
      background: i === activeIndex ? styles.bgSoft : "transparent",
      cursor: "pointer",
      font: styles.font,
      borderBottom:
        i === activeIndex
          ? `2px solid ${styles.accent}`
          : "2px solid transparent",
    });
    triggerRow.appendChild(btn);
    triggers.push(btn);

    const panel = document.createElement("div");
    panel.hidden = i !== activeIndex;
    panel.textContent = tab.body;
    applyStyle(panel, { padding: "12px" });
    panels.push(panel);
  });

  function activate(next: number) {
    activeIndex = next;
    triggers.forEach((btn, i) => {
      const isActive = i === activeIndex;
      btn.style.background = isActive ? styles.bgSoft : "transparent";
      btn.style.borderBottom = isActive
        ? `2px solid ${styles.accent}`
        : "2px solid transparent";
    });
    panels.forEach((p, i) => {
      p.hidden = i !== activeIndex;
    });
  }

  triggers.forEach((btn, i) => {
    btn.addEventListener("click", () => activate(i));
  });

  root.appendChild(triggerRow);
  panels.forEach((p) => root.appendChild(p));
  host.appendChild(root);
}
