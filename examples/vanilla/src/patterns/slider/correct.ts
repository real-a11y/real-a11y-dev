import { applyStyle, styles } from "../_shared.js";

// Correct APG Slider — hand-rolled single-thumb horizontal slider.
//
// Implements:
//   - role="slider" on the thumb + aria-valuemin/aria-valuemax/aria-valuenow
//   - aria-orientation (optional; horizontal is the default)
//   - aria-label so the slider has an accessible name
//   - Focusable thumb (tabindex=0)
//   - ArrowLeft/ArrowRight (and Down/Up) move by step; Home/End jump to bounds
//   - PageUp/PageDown move by larger increment
//   - Mouse drag updates the value too
export function mountSliderCorrect(host: HTMLElement): void {
  const min = 0;
  const max = 100;
  const step = 1;
  let value = 50;

  const root = document.createElement("div");
  applyStyle(root, {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    minWidth: "240px",
  });

  const label = document.createElement("div");
  label.textContent = "Volume";
  label.id = "slider-correct-label";
  applyStyle(label, { fontWeight: "600", fontSize: "14px" });

  const track = document.createElement("div");
  applyStyle(track, {
    position: "relative",
    height: "6px",
    background: styles.bgSoft,
    borderRadius: "3px",
    cursor: "pointer",
  });

  const fill = document.createElement("div");
  applyStyle(fill, {
    position: "absolute",
    top: "0",
    left: "0",
    height: "100%",
    background: styles.accent,
    borderRadius: "3px",
    width: `${value}%`,
  });

  const thumb = document.createElement("div");
  thumb.setAttribute("role", "slider");
  thumb.setAttribute("aria-valuemin", String(min));
  thumb.setAttribute("aria-valuemax", String(max));
  thumb.setAttribute("aria-valuenow", String(value));
  thumb.setAttribute("aria-labelledby", "slider-correct-label");
  thumb.tabIndex = 0;
  applyStyle(thumb, {
    position: "absolute",
    top: "50%",
    width: "16px",
    height: "16px",
    background: styles.bg,
    border: `2px solid ${styles.accent}`,
    borderRadius: "50%",
    transform: "translate(-50%, -50%)",
    cursor: "grab",
    left: `${value}%`,
    outline: "none",
  });

  function update(next: number) {
    value = Math.max(min, Math.min(max, Math.round(next / step) * step));
    thumb.setAttribute("aria-valuenow", String(value));
    thumb.style.left = `${value}%`;
    fill.style.width = `${value}%`;
  }

  thumb.addEventListener("keydown", (e) => {
    const big = (max - min) / 10;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      update(value + step);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      update(value - step);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      update(value + big);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      update(value - big);
    } else if (e.key === "Home") {
      e.preventDefault();
      update(min);
    } else if (e.key === "End") {
      e.preventDefault();
      update(max);
    }
  });

  track.addEventListener("mousedown", (e) => {
    const rect = track.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * (max - min) + min;
    update(pct);
    thumb.focus();

    const onMove = (ev: MouseEvent) => {
      const p = ((ev.clientX - rect.left) / rect.width) * (max - min) + min;
      update(p);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  track.appendChild(fill);
  track.appendChild(thumb);
  root.appendChild(label);
  root.appendChild(track);
  host.appendChild(root);
}
