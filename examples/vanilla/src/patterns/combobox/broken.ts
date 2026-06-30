import { applyStyle, styles } from "../_shared.js";

// Hand-rolled "broken" Combobox. Deliberately wrong on:
//
//   1. Input has NO role="combobox", NO aria-expanded, NO aria-controls,
//      NO aria-autocomplete. Reads as a plain textbox.
//
//   2. Dropdown is a plain <ul> of <li>s with NO role="listbox" /
//      role="option", and NO aria-activedescendant updates as the user
//      arrows around (no keyboard nav at all here — only mouse).
//
//   3. NO announced result count, no live region.
export function mountComboboxBroken(host: HTMLElement): void {
  const options = [
    { id: "apple", label: "Apple" },
    { id: "banana", label: "Banana" },
    { id: "cherry", label: "Cherry" },
    { id: "date", label: "Date" },
    { id: "elderberry", label: "Elderberry" },
  ];

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

  const inputRow = document.createElement("div");
  applyStyle(inputRow, { display: "inline-flex" });

  const input = document.createElement("input");
  input.type = "text";
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
  applyStyle(toggle, {
    padding: "0 10px",
    border: `1px solid ${styles.border}`,
    borderRadius: `0 ${styles.radius} ${styles.radius} 0`,
    background: "transparent",
    cursor: "pointer",
    font: styles.font,
  });

  const list = document.createElement("ul");
  applyStyle(list, {
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

  function render(filter: string) {
    list.innerHTML = "";
    const lowered = filter.toLowerCase();
    options
      .filter((o) => o.label.toLowerCase().includes(lowered))
      .forEach((o) => {
        const li = document.createElement("li");
        applyStyle(li, { margin: "0" });
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = o.label;
        applyStyle(btn, {
          display: "block",
          width: "100%",
          textAlign: "left",
          padding: "6px 10px",
          border: "none",
          borderRadius: "4px",
          background: "transparent",
          cursor: "pointer",
          font: styles.font,
        });
        btn.addEventListener("click", () => {
          input.value = o.label;
          close();
        });
        li.appendChild(btn);
        list.appendChild(li);
      });
  }

  function open() {
    list.style.display = "";
    render(input.value);
  }
  function close() {
    list.style.display = "none";
  }

  input.addEventListener("input", () => {
    if (list.style.display === "none") open();
    else render(input.value);
  });
  input.addEventListener("focus", open);
  toggle.addEventListener("click", () => {
    if (list.style.display === "none") {
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
  root.appendChild(list);
  host.appendChild(root);
}
