import type { DisplayProblem } from '../lib/action-state';

/**
 * `problem` without the field errors a form already shows next to their fields (`pointers`), so
 * the summary above the buttons does not repeat them. Errors at other pointers stay listed.
 */
export function withoutFieldErrors(
  problem: DisplayProblem | undefined,
  pointers: readonly string[],
): DisplayProblem | undefined {
  if (problem?.errors === undefined) {
    return problem;
  }
  const { errors, ...summary } = problem;
  const rest = errors.filter((error) => !pointers.includes(error.pointer));
  return rest.length === 0 ? summary : { ...summary, errors: rest };
}
