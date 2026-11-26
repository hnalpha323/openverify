/**
 * C156.1, C156.4 (Workflow 9C, `dashboard-preview`): where a preview or simulate problem is shown.
 * The API's 422 pointers name the request member at fault: the locale menu (`/meta/locale`), the
 * theme picker (`/data/attributes/theme-set-id`), the styles (`/data/attributes/styles/...`), the
 * flow (`/data/attributes/flow`), the scope form (`/meta/scope/...`) and the preset
 * (`/meta/preset-id`). A pointer below its member is kept beside the detail, so the operator can
 * find the value; a 429 is the shared `template-preview` policy (120 a minute per operator).
 */
import type { DisplayProblem } from '../../lib/action-state';

export type ProblemTarget =
  'locale' | 'theme-set' | 'styles' | 'flow' | 'scope' | 'preset' | 'other';

export interface PlacedProblem {
  readonly byTarget: Partial<Record<ProblemTarget, readonly string[]>>;
  readonly rateLimited: boolean;
}

const EXACT: readonly (readonly [string, ProblemTarget])[] = [
  ['/meta/locale', 'locale'],
  ['/data/attributes/theme-set-id', 'theme-set'],
  ['/data/attributes/flow', 'flow'],
  ['/meta/preset-id', 'preset'],
];
const UNDER: readonly (readonly [string, ProblemTarget])[] = [
  ['/data/attributes/styles', 'styles'],
  ['/meta/scope', 'scope'],
];

/** The control a pointer names, and whether the detail should carry the pointer. */
function targetOf(pointer: string): { readonly target: ProblemTarget; readonly deeper: boolean } {
  for (const [exact, target] of EXACT) {
    if (pointer === exact) {
      return { target, deeper: false };
    }
  }
  for (const [prefix, target] of UNDER) {
    if (pointer === prefix || pointer.startsWith(`${prefix}/`)) {
      return { target, deeper: pointer !== prefix };
    }
  }
  return { target: 'other', deeper: false };
}

/** `problem`'s details by the control they belong beside. */
export function placeProblem(problem: DisplayProblem): PlacedProblem {
  const byTarget: Partial<Record<ProblemTarget, string[]>> = {};
  const errors = problem.errors ?? [];
  for (const error of errors) {
    const { target, deeper } = targetOf(error.pointer);
    (byTarget[target] ??= []).push(deeper ? `${error.detail} (${error.pointer})` : error.detail);
  }
  if (errors.length === 0) {
    byTarget.other = [
      problem.detail === undefined ? problem.title : `${problem.title}: ${problem.detail}`,
    ];
  }
  return { byTarget, rateLimited: problem.status === 429 };
}
