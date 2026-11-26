/**
 * C148.5 (Workflow 9A, flow-renderer): the screen step in the live flow. It submits through the
 * flow API (`submitScreen`, through the client that first sends the open screen's signals, C150.9)
 * and reads the session once the server answered, so the next step is always the one the server
 * chose. A 409 `flow_step_not_current` (another tab moved on) reads the session again; a 422 marks
 * each field its pointers name, never echoing a value.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessageKey } from '../api/error-message';
import { FlowApiError, type FlowApiClient } from '../api/flow-api-client';
import { isConflict } from '../api/problem-members';
import type { FlowPosition } from '../flow/flow-position';
import { ScreenStep, type ScreenSubmission } from './screen-step';

/** The field keys a 422's pointers name (`/values/<field>`). */
function refusedFields(error: unknown): string[] {
  if (!(error instanceof FlowApiError) || error.status !== 422) {
    return [];
  }
  return (error.problem?.errors ?? []).flatMap(({ pointer }) => {
    const field = /^\/values\/([a-z][a-z0-9_]{0,63})$/u.exec(pointer)?.[1];
    return field === undefined ? [] : [field];
  });
}

export interface LiveScreenStepProps {
  readonly position: Extract<FlowPosition, { kind: 'screen' }>;
  readonly client: FlowApiClient;
  /** Reads the session once the server answered. */
  readonly onSubmitted: () => Promise<void>;
  /** The person stopped for now (a confirmed `cancel` button). */
  readonly onCancel: () => void;
  readonly copy: (key: string) => string | null;
  /** WCAG 3.1.2: the language of a key's text when it is not the page's (C162.5's fallback). */
  readonly copyLanguage?: (key: string) => string | null;
}

export function LiveScreenStep({
  position,
  client,
  onSubmitted,
  onCancel,
  copy,
  copyLanguage,
}: LiveScreenStepProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const [refused, setRefused] = useState<readonly string[]>([]);

  const submit = async (submission: ScreenSubmission) => {
    setError(null);
    setRefused([]);
    try {
      await client.submitScreen(position.step.id, {
        values: { ...submission.values },
        ...(submission.button === undefined ? {} : { button: submission.button }),
      });
    } catch (failure: unknown) {
      if (isConflict(failure)) {
        // The position moved on elsewhere (a second tab, C151.11): show where the server is.
        await onSubmitted();
        return;
      }
      const fields = refusedFields(failure);
      setRefused(fields);
      setError(fields.length > 0 ? null : failure);
      return;
    }
    await onSubmitted();
  };

  return (
    <ScreenStep
      step={position.step}
      values={position.values}
      copy={copy}
      {...(copyLanguage === undefined ? {} : { copyLanguage })}
      onSubmit={submit}
      onCancel={onCancel}
      refused={refused}
      {...(error === null ? {} : { error: t(errorMessageKey(error)) })}
    />
  );
}
