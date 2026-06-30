import { applyStyle, styles } from "../_shared.js";

// Correct APG Menu Button + Menu. Implements:
//   - Trigger: aria-haspopup="menu" + aria-expanded reflecting state +
//     aria-controls pointing at the menu's id
//   - Panel: role="menu" + per-item role="menuitem"
//   - Focus moves into the first menuitem on open; returns to the
//     trigger on close
//   - ↑/↓ to move between items, Home/End for bounds, Escape closes,
//     Tab also closes (and lets focus continue out of the menu)
//   - Roving tabindex: only the active menuitem is tabindex=0; others -1
let nextId = 0;
export function mountMenuCorrect(host: HTMLElement): void {
  const id = `menu-correct-${nextId++}`;
  const items = ["Edit profile", "Settings", "Sign out"];

  const root = document.createElement("div");
  applyStyle(root, { position: "relative", display: "inline-block" });

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.textContent = "Account ▾";
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", id);
  applyStyle(trigger, {
    padding: "6px 12px",
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    background: "transparent",
    cursor: "pointer",
    font: styles.font,
  });

  const menu = document.createElement("div");
  menu.id = id;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Account");
  menu.hidden = true;
  applyStyle(menu, {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: "0",
    background: styles.bg,
    border: `1px solid ${styles.border}`,
    borderRadius: styles.radius,
    padding: "4px",
    minWidth: "160px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    zIndex: "10",
  });

  const itemEls: HTMLDivElement[] = items.map((label, i) => {
    const el = document.createElement("div");
    el.setAttribute("role", "menuitem");
    el.textContent = label;
    el.tabIndex = i === 0 ? 0 : -1;
    applyStyle(el, {
      padding: "6px 10px",
      borderRadius: "4px",
      cursor: "pointer",
      outline: "none",
    });
    el.addEventListener("focus", () => {
      el.style.background = styles.bgSoft;
    });
    el.addEventListener("blur", () => {
      el.style.background = "transparent";
    });
    el.addEventListener("click", () => close());
    menu.appendChild(el);
    return el;
  });

  let activeIndex = 0;

  function open() {
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    activeIndex = 0;
    itemEls.forEach((el, i) => {
      el.tabIndex = i === 0 ? 0 : -1;
    });
    itemEls[0].focus();
  }

  function close() {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.focus();
  }

  function focusItem(i: number) {
    activeIndex = (i + itemEls.length) % itemEls.length;
    itemEls.forEach((el, idx) => {
      el.tabIndex = idx === activeIndex ? 0 : -1;
    });
    itemEls[activeIndex].focus();
  }

  trigger.addEventListener("click", () => {
    if (menu.hidden) open();
    else close();
  });

  menu.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusItem(activeIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusItem(activeIndex - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusItem(itemEls.length - 1);
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      close();
    }
  });

  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });

  root.appendChild(trigger);
  root.appendChild(menu);
  host.appendChild(root);
}
