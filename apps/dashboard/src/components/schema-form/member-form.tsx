'use client';

/**
 * C153.1, C153.3: one member of a template draft as a form generated from the contract
 * (`SchemaForm`), with the raw JSON one click away. The value is posted as JSON with the version's
 * ETag, which the action sends as `If-Match` (C154.3). Nothing is sent while the contract refuses a
 * value; the API's refusals and the saved draft's own publish problems (its `validation`, C154.2)
 * are shown at their fields, a list problem in the words of `lib/version-problem-words.ts`.
 */
import { Button } from '@openverify/ui';
import { useMemo, useState, type ReactNode, type SubmitEvent } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';
import { SIGNAL_PROBLEM_WORDS } from '../../lib/version-problem-words';
import { withoutFieldErrors } from '../field-errors';
import { JsonEditor } from '../json-editor';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import { listPickerOf } from './list-picker';
import { problemsOf, type MemberProblem } from './model';
import { SchemaForm, type SchemaWidget } from './schema-form';
import {
  FORM_MEMBER_SCHEMAS,
  memberPointer,
  settingsNotes,
  type FormMemberKey,
} from './template-members';

const COPY = TEMPLATE_FORMS_COPY;

/** One of the environment's lists, as a picker offers it. */
export interface ListChoice {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
}

/** A problem of the saved draft's `validation`, its pointer inside the member. */
export interface SavedProblem {
  readonly pointer: string;
  readonly code: string;
  readonly detail: string;
  readonly severity: 'error' | 'warning';
}

export interface MemberFormProps {
  readonly member: FormMemberKey;
  /** The member's value as the version serves it. */
  readonly initial: Readonly<Record<string, unknown>>;
  readonly ids: { readonly templateId: string; readonly versionId: string; readonly etag: string };
  readonly action: (state: ActionState, formData: FormData) => Promise<ActionResult>;
  readonly readOnly?: boolean;
  /** The environment's lists, for `list-config`'s picker. */
  readonly lists?: readonly ListChoice[];
  readonly saved?: readonly SavedProblem[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const wordsOf = (problem: SavedProblem): string => {
  const words = Object.hasOwn(SIGNAL_PROBLEM_WORDS, problem.code)
    ? SIGNAL_PROBLEM_WORDS[problem.code as keyof typeof SIGNAL_PROBLEM_WORDS]
    : problem.detail;
  return problem.severity === 'warning' ? `Warning: ${words}` : words;
};

function notesOf(member: FormMemberKey, value: Readonly<Record<string, unknown>>) {
  if (member === 'settings') return settingsNotes(value);
  if (member === 'links') {
    return {
      'embed-origins': COPY.notes.embedOrigins,
      'redirect-include-status': COPY.notes.redirectStatus,
      'help-url': COPY.notes.links,
      'privacy-url': COPY.notes.links,
    };
  }
  return {};
}

export function MemberForm({
  member,
  initial,
  ids,
  action,
  readOnly = false,
  lists = [],
  saved = [],
}: MemberFormProps): ReactNode {
  const legend = COPY.members[member];
  const schema = FORM_MEMBER_SCHEMAS[member];
  const [value, setValue] = useState<Readonly<Record<string, unknown>>>(initial);
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [jsonText, setJsonText] = useState('');
  const [message, setMessage] = useState('');
  // A new form after the JSON is taken back, so every field shows the new value.
  const [generation, setGeneration] = useState(0);
  const { show } = useToast();
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: COPY.memberForm.saved(legend) });
    },
  });
  const widgets = useMemo<Readonly<Record<string, SchemaWidget>>>(
    () => (member === 'list-config' ? { screen: listPickerOf(lists) } : {}),
    [member, lists],
  );

  if (readOnly) {
    return <SchemaForm legend={legend} schema={schema} value={value} widgets={widgets} readOnly />;
  }

  const apiErrors = (problem?.errors ?? []).flatMap((error): MemberProblem[] => {
    const pointer = memberPointer(member, error.pointer);
    return pointer === null ? [] : [{ pointer, detail: error.detail }];
  });
  const errors = [
    ...saved.map((each) => ({ pointer: each.pointer, detail: wordsOf(each) })),
    ...apiErrors,
  ];
  const shownElsewhere = (problem?.errors ?? [])
    .filter((error) => memberPointer(member, error.pointer) !== null)
    .map((error) => error.pointer);

  const toJson = () => {
    setJsonText(JSON.stringify(value, null, 2));
    setMessage('');
    setMode('json');
  };
  const toForm = () => {
    try {
      const parsed: unknown = JSON.parse(jsonText);
      if (!isRecord(parsed)) {
        throw new TypeError('not an object');
      }
      setValue(parsed);
      setGeneration((count) => count + 1);
      setMessage('');
      setMode('form');
    } catch {
      setMessage(COPY.memberForm.jsonInvalid);
    }
  };

  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    let current = value;
    if (mode === 'json') {
      try {
        const parsed: unknown = JSON.parse(jsonText);
        if (!isRecord(parsed)) throw new TypeError('not an object');
        current = parsed;
        setValue(parsed);
      } catch {
        event.preventDefault();
        setMessage(COPY.memberForm.jsonInvalid);
        return;
      }
    }
    if (problemsOf(schema, current).length > 0) {
      event.preventDefault();
      setMessage(COPY.memberForm.refusedBeforeSending);
      return;
    }
    setMessage('');
    const data = new FormData(event.currentTarget);
    data.set('value', JSON.stringify(current));
    event.preventDefault();
    formProps.action(data);
  };

  return (
    <form
      {...formProps}
      onSubmit={onSubmit}
      aria-label={legend}
      className="flex flex-col gap-4 rounded-lg border border-line p-4"
    >
      <input type="hidden" name="inquiry-template-id" value={ids.templateId} />
      <input type="hidden" name="version-id" value={ids.versionId} />
      <input type="hidden" name="etag" value={ids.etag} />
      <input type="hidden" name="member" value={member} />
      <input type="hidden" name="value" value={JSON.stringify(value)} />
      {saved.length > 0 && <p className="text-sm font-medium">{COPY.memberForm.savedProblems}</p>}
      {mode === 'form' ? (
        <SchemaForm
          key={generation}
          legend={legend}
          schema={schema}
          value={value}
          onChange={setValue}
          widgets={widgets}
          notes={notesOf(member, value)}
          errors={errors}
        />
      ) : (
        <JsonEditor
          label={COPY.memberForm.jsonLabel(legend)}
          name={`${member}-json`}
          rows={12}
          defaultValue={jsonText}
          description={COPY.memberForm.jsonDescription}
          errors={errors}
          onChange={setJsonText}
        />
      )}
      <p role="status" aria-live="polite" className="text-sm font-medium">
        {message}
      </p>
      <ProblemDisplay problem={withoutFieldErrors(problem, shownElsewhere)} />
      <div className="flex flex-wrap gap-3">
        <SubmitButton pendingLabel={COPY.memberForm.saving} pending={pending}>
          {COPY.memberForm.save(legend)}
        </SubmitButton>
        <Button variant="secondary" onClick={mode === 'form' ? toJson : toForm}>
          {mode === 'form'
            ? COPY.memberForm.editAsJson(legend)
            : COPY.memberForm.editAsForm(legend)}
        </Button>
      </div>
    </form>
  );
}
