import { useState, useCallback } from "preact/hooks";

export function useSearch() {
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);

  const updateQuery = useCallback((newQuery: string) => {
    setQuery(newQuery);
  }, []);

  const updateMatchCount = useCallback((count: number) => {
    setMatchCount(count);
  }, []);

  const clearSearch = useCallback(() => {
    setQuery("");
    setMatchCount(0);
  }, []);

  return { query, matchCount, updateQuery, updateMatchCount, clearSearch };
}
