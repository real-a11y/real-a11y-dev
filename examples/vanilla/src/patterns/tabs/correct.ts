import { applyStyle, styles } from "../_shared.js";

// Correct APG Tabs — hand-rolled vanilla equivalent of the Radix
// component used in the React example-patterns package.
//
// Implements:
//   - role="tablist" on the container, role="tab" on each trigger,
//     role="tabpanel" on each panel
//   - aria-selected on the active tab; aria-controls / id wiring
//     between tab and panel
//   - Roving tabindex so only the active tab is in the page tab order
//   - ←/→ keys move between tabs (with wrap); Home/End jump to first/last
//   - Activation follows focus (selectFollowsFocus) — pressing ← activates
//     the previous tab immediately, matching APG's "automatic activation"
//     pattern
export function mountTabsCorrect(host: HTMLElement): void {
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

  const tablist = document.createElement("div");
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "Project sections");
  applyStyle(tablist, {
    display: "flex",
    borderBottom: `1px solid ${styles.border}`,
  });

  const panels: HTMLElement[] = [];
  const triggers: HTMLButtonElement[] = [];
  let activeIndex = 0;

  tabs.forEach((tab, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(i === activeIndex));
    btn.setAttribute("aria-controls", `tab-correct-panel-${tab.id}`);
    btn.id = `tab-correct-tab-${tab.id}`;
    btn.tabIndex = i === activeIndex ? 0 : -1;
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
    tablist.appendChild(btn);
    triggers.push(btn);

    const panel = document.createElement("div");
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `tab-correct-tab-${tab.id}`);
    panel.id = `tab-correct-panel-${tab.id}`;
    panel.hidden = i !== activeIndex;
    panel.tabIndex = 0;
    panel.textContent = tab.body;
    applyStyle(panel, { padding: "12px" });
    panels.push(panel);
  });

  function activate(next: number) {
    activeIndex = (next + tabs.length) % tabs.length;
    triggers.forEach((btn, i) => {
      const isActive = i === activeIndex;
      btn.setAttribute("aria-selected", String(isActive));
      btn.tabIndex = isActive ? 0 : -1;
      btn.style.background = isActive ? styles.bgSoft : "transparent";
      btn.style.borderBottom = isActive
        ? `2px solid ${styles.accent}`
        : "2px solid transparent";
    });
    panels.forEach((p, i) => {
      p.hidden = i !== activeIndex;
    });
    triggers[activeIndex].focus();
  }

  tablist.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      activate(activeIndex + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      activate(activeIndex - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      activate(0);
    } else if (e.key === "End") {
      e.preventDefault();
      activate(tabs.length - 1);
    }
  });

  triggers.forEach((btn, i) => {
    btn.addEventListener("click", () => activate(i));
  });

  root.appendChild(tablist);
  panels.forEach((p) => root.appendChild(p));
  host.appendChild(root);
}
