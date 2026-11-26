'use client';

import {
  GRAPH_PERSON_KINDS,
  type GraphParameterKind,
  type GraphQueryTemplateConfig,
} from '@openverify/contracts';
import { Field, Input } from '@openverify/ui';
import { useId, useState } from 'react';
import type { DraftSaved } from '../../app/graph/actions';
import {
  fieldErrorOf,
  type ActionResult,
  type ActionState,
  type DisplayProblem,
} from '../../lib/action-state';
import { withoutFieldErrors } from '../field-errors';
import { JsonEditor } from '../json-editor';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

/** A run action, whatever it answers (method syntax, so any answer type fits). */
interface RunAction {
  run(state: ActionState<unknown>, formData: FormData): Promise<ActionResult<unknown>>;
}
type Pathed = (
  state: ActionState<{ path: string }>,
  formData: FormData,
) => Promise<ActionResult<{ path: string }>>;
type Saving = (
  state: ActionState<DraftSaved>,
  formData: FormData,
) => Promise<ActionResult<DraftSaved>>;

/**
 * Where a new template starts: direct connections of the account in context through the strong
 * kinds that need no opt-in, which publishes as it is.
 */
export const STARTER_CONFIG: GraphQueryTemplateConfig = Object.freeze({
  parameters: [{ name: 'account_id', kind: 'account_id' }],
  start: [{ kind: 'account_id', value: '{{account_id}}' }],
  'connect-kinds': ['email_address', 'phone_number', 'government_id_number', 'crypto_address'],
  'max-hops': 2,
  'node-limit': 100,
}) as GraphQueryTemplateConfig;

const CONFIG_POINTER = '/data/attributes/config';

const MEMBER_WORDS: Readonly<Record<string, string>> = Object.freeze({
  parameters: 'Parameters (parameters)',
  start: 'Start (start)',
  'connect-kinds': 'Kinds to connect (connect-kinds)',
  'max-hops': 'Hops (max-hops)',
  'node-limit': 'Node limit (node-limit)',
  'include-weak-kinds': 'Weak kinds (include-weak-kinds)',
  filters: 'Filters (filters)',
});

/** The place a pointer inside a configuration names, in words. */
export function configPointerLabel(pointer: string): string | undefined {
  const [member, index] = pointer.split('/').slice(1);
  const words = member === undefined ? undefined : MEMBER_WORDS[member];
  if (words === undefined) {
    return undefined;
  }
  return index !== undefined && /^\d+$/.test(index)
    ? `${words}, item ${String(Number(index) + 1)}`
    : words;
}

const inside = (pointer: string) =>
  pointer === CONFIG_POINTER || pointer.startsWith(`${CONFIG_POINTER}/`);

function configErrors(problem: DisplayProblem | undefined) {
  return (problem?.errors ?? [])
    .filter((error) => inside(error.pointer))
    .map((error) => {
      const pointer = error.pointer.slice(CONFIG_POINTER.length) || '/';
      return { pointer, detail: error.detail, label: configPointerLabel(pointer) };
    });
}

/** The problem less what the editor shows at its place. */
function restOf(problem: DisplayProblem | undefined, ...shown: readonly string[]) {
  return withoutFieldErrors(problem, [
    ...(problem?.errors ?? [])
      .filter((error) => inside(error.pointer))
      .map((error) => error.pointer),
    ...shown,
  ]);
}

const CONFIG_DESCRIPTION =
  'Parameters, the start, the kinds to connect, max-hops (2, 4 or 6), node-limit (1 to 2,000) and filters. A weak kind needs include-weak-kinds and at most 4 hops. Values are bound when a query runs, never written here.';

/** `POST /graph-query-templates`, then the draft whose id the API answers (C102.1). */
export function CreateTemplateForm({ action }: { readonly action: Pathed }) {
  const { pending, problem, formProps } = useFormAction(action);
  const nameError = fieldErrorOf(problem, '/data/attributes/name');
  return (
    <form {...formProps} aria-label="Create a query template" className="flex flex-col gap-4">
      <Field label="Name" error={nameError}>
        <Input name="name" required maxLength={255} autoComplete="off" />
      </Field>
      <JsonEditor
        label="Configuration"
        name="config"
        rows={14}
        defaultValue={JSON.stringify(STARTER_CONFIG, null, 2)}
        description={CONFIG_DESCRIPTION}
        errors={configErrors(problem)}
      />
      <ProblemDisplay problem={restOf(problem, '/data/attributes/name')} />
      <div>
        <SubmitButton pending={pending} pendingLabel="Creating…">
          Create template
        </SubmitButton>
      </div>
    </form>
  );
}

/** `PATCH /graph-query-templates/:id`: the name. */
export function RenameTemplateForm({
  templateId,
  name,
  action,
}: {
  readonly templateId: string;
  readonly name: string;
  readonly action: RunAction['run'];
}) {
  const { show } = useToast();
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'Renamed the template.' });
    },
  });
  return (
    <form {...formProps} aria-label="Rename the template" className="flex flex-col gap-3">
      <input type="hidden" name="graph-query-template-id" value={templateId} />
      <Field label="Name" error={fieldErrorOf(problem, '/data/attributes/name')}>
        <Input name="name" required maxLength={255} defaultValue={name} autoComplete="off" />
      </Field>
      <ProblemDisplay problem={restOf(problem, '/data/attributes/name')} />
      <div>
        <SubmitButton pending={pending} pendingLabel="Renaming…">
          Rename
        </SubmitButton>
      </div>
    </form>
  );
}

/** `POST /graph-query-template-versions`: a new draft from the configuration typed. */
export function NewDraftForm({
  templateId,
  config,
  action,
}: {
  readonly templateId: string;
  readonly config: GraphQueryTemplateConfig;
  readonly action: Pathed;
}) {
  const { pending, problem, formProps } = useFormAction(action);
  return (
    <form {...formProps} aria-label="Create a draft" className="flex flex-col gap-4">
      <input type="hidden" name="graph-query-template-id" value={templateId} />
      <JsonEditor
        label="Draft configuration"
        name="config"
        rows={14}
        defaultValue={JSON.stringify(config, null, 2)}
        description={CONFIG_DESCRIPTION}
        errors={configErrors(problem)}
      />
      <ProblemDisplay problem={restOf(problem)} />
      <div>
        <SubmitButton pending={pending} pendingLabel="Creating…">
          Create draft
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * The draft editor (C102.1): the configuration as JSON, checked by the API at save (pointers in
 * words); after a save, what publishing would refuse (`graphTemplateConfigProblems`), in words at
 * each pointer.
 */
export function DraftEditor({
  templateId,
  versionId,
  config,
  action,
}: {
  readonly templateId: string;
  readonly versionId: string;
  readonly config: GraphQueryTemplateConfig;
  readonly action: Saving;
}) {
  const noteId = useId();
  const { show } = useToast();
  const [saved, setSaved] = useState<DraftSaved | null>(null);
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: (data) => {
      setSaved(data);
      show({ tone: 'success', message: 'Saved the draft.' });
    },
  });
  return (
    <form {...formProps} aria-label="Edit the draft configuration" className="flex flex-col gap-4">
      <input type="hidden" name="graph-query-template-id" value={templateId} />
      <input type="hidden" name="version-id" value={versionId} />
      <JsonEditor
        label="Configuration"
        name="config"
        rows={18}
        defaultValue={JSON.stringify(config, null, 2)}
        description={CONFIG_DESCRIPTION}
        errors={configErrors(problem)}
      />
      <ProblemDisplay problem={restOf(problem)} />
      {saved !== null && saved.publishProblems.length > 0 && (
        <div
          role="note"
          aria-labelledby={noteId}
          className="rounded-md border border-amber-600/40 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <p id={noteId} className="font-medium">
            Publishing this draft would be refused
          </p>
          <ul className="mt-1 list-disc ps-5">
            {saved.publishProblems.map((each) => (
              <li key={`${each.pointer}:${each.words}`}>
                {configPointerLabel(each.pointer) !== undefined && (
                  <span className="block font-medium">{configPointerLabel(each.pointer)}</span>
                )}
                <code className="font-mono text-xs">{each.pointer}</code>: {each.words}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save draft
        </SubmitButton>
      </div>
    </form>
  );
}

const TEXT = 'A text value.';
const FINGERPRINT = 'The 64-hex fingerprint a device resource serves.';

/** What a parameter of each kind takes. */
const PARAMETER_HINTS: Readonly<Record<GraphParameterKind, string>> = Object.freeze({
  account_id: 'An account id, acc_ followed by 26 characters.',
  created_at: 'A time in ISO 8601, such as 2026-10-01T00:00:00Z.',
  government_id_number:
    'JSON: {"issuing-authority-code", "identification-number", and an optional "id-class"}.',
  chip_signature: 'Cannot be bound: a chip signature has no plaintext.',
  crypto_address: 'JSON: {"chain-id", "address"}.',
  email_address: 'An email address.',
  phone_number: 'A phone number in international form, starting with +.',
  email_address_unconfirmed: 'An email address.',
  phone_number_unconfirmed: 'A phone number in international form, starting with +.',
  reference_id: 'An account reference ID.',
  name_birthdate: 'JSON: {"name-first", "name-last", "birthdate" as YYYY-MM-DD}.',
  address: 'JSON with the six address-* members of a list item.',
  device_fingerprint: FINGERPRINT,
  device_class: FINGERPRINT,
  browser_fingerprint: FINGERPRINT,
  ip_address: 'An IP address.',
  name: 'JSON: {"name-first", "name-last"}.',
  birthdate: 'A date, YYYY-MM-DD.',
  postal_code: TEXT,
  email_domain: 'An email domain, such as example.org.',
});

const PERSON_KINDS: ReadonlySet<string> = new Set(GRAPH_PERSON_KINDS);

/**
 * Runs a template's published version (C102.4): a labelled field per parameter with the hint of
 * its kind. A person-identifying parameter needs `pii:view` (P11): without it the field and the
 * run are disabled, and the form says why. "Wait for the result" runs it synchronously (at most
 * 10 seconds, two at once per environment).
 */
export function RunQueryForm({
  templateId,
  parameters,
  piiView,
  action,
}: {
  readonly templateId: string;
  readonly parameters: GraphQueryTemplateConfig['parameters'];
  readonly piiView: boolean;
  readonly action: RunAction['run'];
}) {
  const { pending, problem, formProps } = useFormAction(action);
  const blocked = !piiView && parameters.some((parameter) => PERSON_KINDS.has(parameter.kind));
  return (
    <form {...formProps} aria-label="Run a query" className="flex flex-col gap-4">
      <input type="hidden" name="graph-query-template-id" value={templateId} />
      {parameters.length === 0 && (
        <p className="text-sm text-ink-muted">This template takes no parameters.</p>
      )}
      {parameters.map((parameter) => {
        const person = PERSON_KINDS.has(parameter.kind);
        return (
          <Field
            key={parameter.name}
            label={parameter.name}
            description={`${PARAMETER_HINTS[parameter.kind]}${person && !piiView ? ' This parameter identifies a person, so running it needs pii:view, which your role does not hold.' : ''}`}
            error={fieldErrorOf(problem, `/data/attributes/parameter-map/${parameter.name}`)}
          >
            <Input
              name={`parameter:${parameter.name}`}
              autoComplete="off"
              spellCheck={false}
              disabled={person && !piiView}
            />
          </Field>
        );
      })}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="run-sync" />
        Wait for the result (at most 10 seconds)
      </label>
      <ProblemDisplay
        problem={withoutFieldErrors(
          problem,
          parameters.map((parameter) => `/data/attributes/parameter-map/${parameter.name}`),
        )}
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Running…" disabled={blocked}>
          Run query
        </SubmitButton>
      </div>
    </form>
  );
}
