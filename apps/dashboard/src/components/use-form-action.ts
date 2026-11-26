'use client';

import { startTransition, useActionState, useRef, useState, type SubmitEvent } from 'react';
import { requestFormReset } from 'react-dom';
import type { ActionResult, ActionState, DisplayProblem } from '../lib/action-state';

export interface FormActionCallbacks<Data> {
  /** After the action succeeded, with what it answered. */
  readonly onSuccess?: (data: Data) => void;
  /** After the action was refused, with its problem. */
  readonly onProblem?: (problem: DisplayProblem) => void;
  /**
   * Empties the form after a success, as React does for a `<form action>`: for a form that stays
   * on the page to add another item (a tag, a relation). A refusal never empties it.
   */
  readonly resetOnSuccess?: boolean;
}

export interface FormAction {
  /** While the action runs. */
  readonly pending: boolean;
  /** The problem of the last refused submission, until one succeeds or it is cleared. */
  readonly problem: DisplayProblem | undefined;
  /** Forgets the problem, for a form shown again (a dialog opened anew). */
  readonly clearProblem: () => void;
  /** Runs the action with data the caller collected, such as a form held for a confirmation. */
  readonly submit: (formData: FormData) => void;
  /** Spread on the `<form>`. */
  readonly formProps: {
    readonly action: (formData: FormData) => void;
    readonly onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  };
}

/**
 * The one way a dashboard form runs a server action built with `runAction` (Workflow 2D F004,
 * K003). Spread `formProps` on the `<form>`:
 *
 * - `action` keeps the server action on the form. Rendered on the server, the form then carries
 *   React's guard instead of a plain `<form>`, and a submission made before hydration is held
 *   and replayed once React runs: it never becomes a native GET with the fields in the URL.
 * - `onSubmit` prevents the submit event and dispatches the action itself. React 19 resets the
 *   uncontrolled fields of a `<form action>` after every run, refused ones included; it does not
 *   run (nor reset) a form action whose submit event was prevented. So a refused submission
 *   keeps everything the operator typed, and only the fields the problem names need correcting.
 *   With `resetOnSuccess` the form is emptied after a success, as React would; a form that must
 *   forget a value after a refusal (a one-time code) does so itself in `onProblem`.
 * - Inside the form, `SubmitButton` needs `pending` from here: React's form status does not see
 *   an action dispatched this way.
 *
 * ```tsx
 * const form = useFormAction(createThing, { onSuccess: (thing) => router.push(thing.href) });
 * return (
 *   <form {...form.formProps}>
 *     ...
 *     <ProblemDisplay problem={form.problem} />
 *     <Button type="submit" disabled={form.pending}>Create</Button>
 *   </form>
 * );
 * ```
 */
export function useFormAction<Data = undefined>(
  action: (state: ActionState<Data>, formData: FormData) => Promise<ActionResult<Data>>,
  { onSuccess, onProblem, resetOnSuccess = false }: FormActionCallbacks<Data> = {},
): FormAction {
  const [problem, setProblem] = useState<DisplayProblem>();
  // The form of the last submit event, to empty after a success when asked.
  const submitted = useRef<HTMLFormElement | null>(null);
  // The action state keeps nothing: what an action answers can be a secret shown once (an API
  // key token, a webhook secret), which must live only where `onSuccess` puts it (C21).
  const [, formAction, pending] = useActionState<null, FormData>(async (_previous, formData) => {
    const result = await action(null, formData);
    if (result.ok) {
      setProblem(undefined);
      if (resetOnSuccess && submitted.current !== null) {
        requestFormReset(submitted.current);
      }
      onSuccess?.(result.data);
    } else {
      setProblem(result.problem);
      onProblem?.(result.problem);
    }
    return null;
  }, null);
  const submit = (formData: FormData) => {
    startTransition(() => {
      formAction(formData);
    });
  };
  return {
    pending,
    problem,
    clearProblem: () => {
      setProblem(undefined);
    },
    submit,
    formProps: {
      action: formAction,
      onSubmit: (event) => {
        event.preventDefault();
        submitted.current = event.currentTarget;
        // The button that submitted, with its name and value (several submit buttons).
        submit(new FormData(event.currentTarget, event.nativeEvent.submitter));
      },
    },
  };
}
