import { applyStyle, styles } from "../_shared.js";

// Hand-rolled "broken" Slider. Deliberately wrong on three axes:
//
//   1. NO role="slider", NO aria-valuemin / aria-valuemax / aria-valuenow.
//      Screen readers can't announce the current value or the bounds.
//
//   2. NOT keyboard-operable. The thumb has no tabindex and listens
//      only for mouse events. Keyboard users can't change the value at all.
//
//   3. NO accessible name. The visible label is just plain text near
//      the track — not associated to the thumb.
//
// Visually identical to the correct variant — same track, fill, thumb.
export function mountSliderBroken(host: HTMLElement): void {
  const min = 0;
  const max = 100;
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
  });

  function update(next: number) {
    value = Math.max(min, Math.min(max, next));
    thumb.style.left = `${value}%`;
    fill.style.width = `${value}%`;
  }

  track.addEventListener("mousedown", (e) => {
    const rect = track.getBoundingClientRect();
    update(((e.clientX - rect.left) / rect.width) * (max - min) + min);

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
