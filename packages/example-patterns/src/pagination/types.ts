export interface PaginationExampleProps {
  /** 1-indexed current page. */
  currentPage: number;
  /** Total number of pages. */
  totalPages: number;
  /**
   * Called when a page is selected. Kept optional so the demo can wire it
   * up or leave it as a no-op depending on context.
   */
  onPageChange?: (page: number) => void;
}
