import { applyStyle, styles } from "../_shared.js";

// Correct APG Combobox (autocomplete-list pattern). Implements:
//   - <input role="combobox"> with aria-expanded, aria-controls,
//     aria-autocomplete="list", aria-activedescendant
//   - Associated listbox popover with role="listbox" + role="option"
//     children; the listbox id matches the input's aria-controls
//   - Free-text filtering: typing narrows the visible options; the
//     active option (via aria-activedescendant) is highlighted
//   - ↓ opens the popover and focuses the first option; ↑/↓ move
//     between options; Home/End jump to bounds; Enter selects;
//     Escape closes / clears
let nextId = 0;
export function mountComboboxCorrect(host: HTMLElement): void {
  const options = [
    { id: "apple", label: "Apple" },
    { id: "banana", label: "Banana" },
    { id: "cherry", label: "Cherry" },
    { id: "date", label: "Date" },
    { id: "elderberry", label: "Elderberry" },
  ];
  const listboxId = `combobox-correct-list-${nextId++}`;

  const root = document.createElement("div");
  applyStyle(root, {
    display: "inline-flex",
    flexDirection: "column",
    gap: "4px",
    position: "relative",
  });

  const label = document.createElement("label");
  label.textContent = "Fruit";
  applyStyle(label, { fontWeight: "600", fontSize: "14px" });
  const labelId = `${listboxId}-label`;
  label.id = labelId;

  const inputRow = document.createElement("div");
  applyStyle(inputRow, { display: "inline-flex" });

  const input = document.createElement("input");
  input.type = "text";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", listboxId);
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-labelledby", labelId);
  input.placeholder = "Type to filter…";
  applyStyle(input, {
    padding: "6px 10px",
    border: `1px solid ${styles.border}`,
    borderRight: "none",
    borderRadius: `${styles.radius} 0 0 ${styles.radius}`,
    background: styles.bg,
    font: styles.font,
    minWidth: "180px",
  });

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = "▾";
  toggle.setAttribute("aria-label", "Show options");
  toggle.setAttribute("tabindex", "-1");
  applyStyle(toggle, {
    padding: "0 10px",
    border: `1px solid ${styles.border}`,
    borderRadius: `0 ${styles.radius} ${styles.radius} 0`,
    background: "transparent",
    cursor: "pointer",
    font: styles.font,
  });

  const listbox = document.createElement("ul");
  listbox.id = listboxId;
  listbox.setAttribute("role", "listbox");
  listbox.setAttribute("aria-labelledby", labelId);
  applyStyle(listbox, {
    position: "absolute",
    top: "100%",
    left: "0",
    margin: "0",
    padding: "4px",
    listStyle: "none",
    background: styles.bg,
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    minWidth: "200px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    zIndex: "10",
    display: "none",
  });

  let activeIndex = -1;
  const optionEls: HTMLLIElement[] = [];

  function render(filter: string) {
    listbox.innerHTML = "";
    optionEls.length = 0;
    const lowered = filter.toLowerCase();
    options
      .filter((o) => o.label.toLowerCase().includes(lowered))
      .forEach((o, i) => {
        const li = document.createElement("li");
        li.id = `${listboxId}-${o.id}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", "false");
        li.textContent = o.label;
        applyStyle(li, {
          padding: "6px 10px",
          borderRadius: "4px",
          cursor: "pointer",
        });
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          select(i);
        });
        listbox.appendChild(li);
        optionEls.push(li);
      });
    activeIndex = optionEls.length > 0 ? 0 : -1;
    updateActive();
  }

  function updateActive() {
    optionEls.forEach((el, i) => {
      el.style.background = i === activeIndex ? styles.bgSoft : "transparent";
    });
    if (activeIndex >= 0 && optionEls[activeIndex]) {
      input.setAttribute("aria-activedescendant", optionEls[activeIndex].id);
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function open() {
    listbox.style.display = "";
    input.setAttribute("aria-expanded", "true");
    render(input.value);
  }

  function close() {
    listbox.style.display = "none";
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function select(i: number) {
    const opt = optionEls[i];
    if (!opt) return;
    input.value = opt.textContent ?? "";
    close();
  }

  input.addEventListener("input", () => {
    if (listbox.style.display === "none") open();
    else render(input.value);
  });
  input.addEventListener("focus", open);
  input.addEventListener("blur", () => {
    // Delay so a click on an option fires its mousedown handler first.
    setTimeout(close, 100);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (listbox.style.display === "none") open();
      else {
        activeIndex = Math.min(activeIndex + 1, optionEls.length - 1);
        updateActive();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActive();
    } else if (e.key === "Home") {
      e.preventDefault();
      activeIndex = 0;
      updateActive();
    } else if (e.key === "End") {
      e.preventDefault();
      activeIndex = optionEls.length - 1;
      updateActive();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0) select(activeIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });

  toggle.addEventListener("click", () => {
    if (listbox.style.display === "none") {
      input.focus();
      open();
    } else {
      close();
    }
  });

  inputRow.appendChild(input);
  inputRow.appendChild(toggle);
  root.appendChild(label);
  root.appendChild(inputRow);
  root.appendChild(listbox);
  host.appendChild(root);
}
