import { Alert } from '@openverify/ui';
import { useId } from 'react';
import type { DisplayProblem } from '../lib/action-state';

export interface ProblemDisplayProps {
  readonly problem: DisplayProblem | undefined;
  readonly className?: string;
}

/**
 * A failed action's problem as an alert: the API's title and detail, the field errors and the
 * request id to quote. Never a stack (`displayProblemOf` keeps only these members).
 */
export function ProblemDisplay({ problem, className }: ProblemDisplayProps) {
  const listLabelId = useId();
  if (problem === undefined) {
    return null;
  }
  const errors = problem.errors ?? [];
  return (
    <Alert tone="error" title={problem.title} {...(className === undefined ? {} : { className })}>
      {problem.detail !== undefined && <p>{problem.detail}</p>}
      {errors.length > 0 && (
        <>
          <p id={listLabelId} className="sr-only">
            Problems
          </p>
          <ul aria-labelledby={listLabelId} className="mt-2 list-disc ps-5">
            {errors.map((error) => (
              <li key={`${error.pointer}:${error.detail}`}>
                <code className="font-mono text-xs">{error.pointer}</code>: {error.detail}
              </li>
            ))}
          </ul>
        </>
      )}
      {problem.requestId !== undefined && (
        <p className="mt-2 text-xs">
          Reference: <code className="font-mono">{problem.requestId}</code>
        </p>
      )}
    </Alert>
  );
}
