import type { PaginationExampleProps } from "./types.js";

// Correct pagination. Follows the pattern APG suggests for
// paginated navigation:
//
//   - <nav aria-label="Pagination"> — a named navigation landmark.
//     Screen readers list "Pagination" among the page's landmarks,
//     and users can jump directly to it.
//   - <ol> of <li> — ordered list of page links (order is meaningful).
//   - Each page link is a real <button> with an aria-label that
//     includes the word "Page" (visible text is just the number for
//     brevity, so the label restores full context).
//   - The current page uses `aria-current="page"` — announced by
//     screen readers as "current page" so users know where they are
//     without hunting for a highlight.
//   - Prev / Next buttons are `aria-disabled` at the bounds instead
//     of being removed, so the tab order stays stable.
export function PaginationCorrect({
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
    <nav aria-label="Pagination">
      <ol
        style={{
          display: "inline-flex",
          gap: 4,
          listStyle: "none",
          padding: 0,
          margin: 0,
        }}
      >
        <li>
          <button
            type="button"
            aria-label="Previous page"
            aria-disabled={atStart}
            onClick={() => !atStart && go(currentPage - 1)}
            style={{
              ...linkStyle,
              opacity: atStart ? 0.5 : 1,
              cursor: atStart ? "not-allowed" : "pointer",
            }}
          >
            ‹
          </button>
        </li>
        {pages.map((p) => {
          const isCurrent = p === currentPage;
          return (
            <li key={p}>
              <button
                type="button"
                aria-label={`Page ${p}${isCurrent ? ", current page" : ""}`}
                aria-current={isCurrent ? "page" : undefined}
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
            </li>
          );
        })}
        <li>
          <button
            type="button"
            aria-label="Next page"
            aria-disabled={atEnd}
            onClick={() => !atEnd && go(currentPage + 1)}
            style={{
              ...linkStyle,
              opacity: atEnd ? 0.5 : 1,
              cursor: atEnd ? "not-allowed" : "pointer",
            }}
          >
            ›
          </button>
        </li>
      </ol>
    </nav>
  );
}
