/**
 * Runs one browser read; a read that throws answers `fallback`, so a missing or blocked API never
 * breaks the page (plan Risks: "failures in the collector are swallowed").
 */
export function probe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}
