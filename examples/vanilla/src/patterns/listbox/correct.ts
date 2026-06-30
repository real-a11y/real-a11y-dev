import { applyStyle, styles } from "../_shared.js";

// Correct APG Listbox. Implements:
//   - role="listbox" + aria-label on the container
//   - role="option" + aria-selected on each item
//   - Roving tabindex: the listbox itself is the tab stop (tabindex=0),
//     and we track the active option via aria-activedescendant. (The
//     alternate model — tabindex on each option — is also valid; we
//     pick activedescendant here so the demo shows both options patterns
//     across the codebase.)
//   - ↑/↓ to move the active option, Home/End for bounds, Enter/Space
//     to select
export function mountListboxCorrect(host: HTMLElement): void {
  const opts = [
    { id: "low", label: "Low" },
    { id: "med", label: "Medium" },
    { id: "high", label: "High" },
  ];

  const list = document.createElement("div");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Priority");
  list.tabIndex = 0;
  applyStyle(list, {
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    padding: "4px",
    minWidth: "200px",
    background: styles.bg,
    outline: "none",
  });

  let activeIndex = 1; // start on "Medium"
  let selectedIndex = 1;
  const optionEls: HTMLDivElement[] = [];

  opts.forEach((o, i) => {
    const el = document.createElement("div");
    el.id = `listbox-correct-${o.id}`;
    el.setAttribute("role", "option");
    el.setAttribute("aria-selected", String(i === selectedIndex));
    el.textContent = o.label;
    applyStyle(el, {
      padding: "6px 10px",
      borderRadius: "4px",
      cursor: "pointer",
      fontWeight: i === selectedIndex ? "600" : "400",
      background: i === activeIndex ? styles.bgSoft : "transparent",
    });
    el.addEventListener("click", () => select(i));
    list.appendChild(el);
    optionEls.push(el);
  });

  list.setAttribute("aria-activedescendant", optionEls[activeIndex].id);

  function highlight(i: number) {
    activeIndex = (i + opts.length) % opts.length;
    optionEls.forEach((el, idx) => {
      el.style.background = idx === activeIndex ? styles.bgSoft : "transparent";
    });
    list.setAttribute("aria-activedescendant", optionEls[activeIndex].id);
  }

  function select(i: number) {
    selectedIndex = i;
    optionEls.forEach((el, idx) => {
      el.setAttribute("aria-selected", String(idx === selectedIndex));
      el.style.fontWeight = idx === selectedIndex ? "600" : "400";
    });
    highlight(i);
  }

  list.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlight(activeIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlight(activeIndex - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      highlight(0);
    } else if (e.key === "End") {
      e.preventDefault();
      highlight(opts.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(activeIndex);
    }
  });

  host.appendChild(list);
}
