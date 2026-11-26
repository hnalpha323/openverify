import type { DisplayProblem } from '../../lib/action-state';

/**
 * The field errors at `pointer` and below it, joined, for a group of controls: the API and the
 * contract point at members inside a list or map (`/data/attributes/filters/…/0`).
 */
export function errorsUnder(
  problem: DisplayProblem | undefined,
  pointer: string,
): string | undefined {
  const details = (problem?.errors ?? [])
    .filter((error) => error.pointer === pointer || error.pointer.startsWith(`${pointer}/`))
    .map((error) => error.detail);
  return details.length === 0 ? undefined : details.join('. ');
}
