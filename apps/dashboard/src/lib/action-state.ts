/**
 * What a server action answers (C21), in a module client components may import: it has no
 * server-only imports. Actions build these with `runAction` (`lib/api/action.ts`).
 */

/** A problem as forms and panels show it: plain text, serializable, never a stack. */
export interface DisplayProblem {
  readonly title: string;
  readonly detail?: string;
  readonly status?: number;
  /** The API's request id, to quote when asking for help. */
  readonly requestId?: string;
  /** The problem's machine-readable `code`, such as `report_match_superseded` (C72.4). */
  readonly code?: string;
  /** Field errors, by JSON Pointer into the request (`/data/attributes/name`, `/email`). */
  readonly errors?: readonly { readonly pointer: string; readonly detail: string }[];
}

export type ActionResult<Data = undefined> =
  | { readonly ok: true; readonly data: Data }
  | { readonly ok: false; readonly problem: DisplayProblem };

/** The `useActionState` state of a form: `null` until it is submitted. */
export type ActionState<Data = undefined> = ActionResult<Data> | null;

/** The field errors at any of `pointers`, joined, for a `FormField`'s `error`. */
export function fieldErrorOf(
  problem: DisplayProblem | undefined,
  ...pointers: readonly string[]
): string | undefined {
  const details = (problem?.errors ?? [])
    .filter((error) => pointers.includes(error.pointer))
    .map((error) => error.detail);
  return details.length === 0 ? undefined : details.join('. ');
}
