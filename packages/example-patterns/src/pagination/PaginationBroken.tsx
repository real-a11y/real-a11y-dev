import type { PaginationExampleProps } from "./types.js";

// Hand-rolled "broken" pagination. Deliberately wrong on the
// navigation-landmark + current-page axis:
//
//   1. NO <nav> landmark. Screen reader users can't jump to
//      pagination as one of the page's landmarks; it's just loose
//      buttons in the DOM.
//
//   2. NO aria-current="page" on the active button — the current
//      page is only conveyed by bold styling. AT users landing on
//      the button have no idea which page they're on.
//
//   3. NO aria-label carrying "Page N" context — each button's
//      accessible name is just the number, so a screen reader user
//      hearing "3" out of context has to guess what it means.
//
// Visually identical to the correct variant.
export function PaginationBroken({
  currentPage,
  totalPages,
  onPageChange,
}: PaginationExampleProps) {
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  const go = (p: number) => {
    if (p < 1 || p > totalPages) return;
    onPageChange?.(p);
  };
  const atStart = currentPage <= 1;
  const atEnd = currentPage >= totalPages;

  const linkStyle = {
    padding: "6px 10px",
    border: "1px solid var(--vp-c-border, #ccc)",
    borderRadius: 6,
    background: "transparent",
    cursor: "pointer",
    font: "inherit",
    minWidth: 32,
    textAlign: "center" as const,
  };

  return (
    <div style={{ display: "inline-flex", gap: 4 }}>
      <button
        type="button"
        onClick={() => !atStart && go(currentPage - 1)}
        style={{
          ...linkStyle,
          opacity: atStart ? 0.5 : 1,
          cursor: atStart ? "not-allowed" : "pointer",
        }}
      >
        ‹
      </button>
      {pages.map((p) => {
        const isCurrent = p === currentPage;
        return (
          <button
            key={p}
            type="button"
            onClick={() => go(p)}
            style={{
              ...linkStyle,
              fontWeight: isCurrent ? 700 : 400,
              background: isCurrent
                ? "var(--vp-c-brand-soft, rgba(46,121,255,0.12))"
                : "transparent",
              borderColor: isCurrent
                ? "var(--vp-c-brand, #2e79ff)"
                : "var(--vp-c-border, #ccc)",
            }}
          >
            {p}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => !atEnd && go(currentPage + 1)}
        style={{
          ...linkStyle,
          opacity: atEnd ? 0.5 : 1,
          cursor: atEnd ? "not-allowed" : "pointer",
        }}
      >
        ›
      </button>
    </div>
  );
}
