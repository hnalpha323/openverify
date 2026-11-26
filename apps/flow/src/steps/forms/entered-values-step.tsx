import {
  MAX_ASSOCIATED_PERSONS,
  toApiVerificationType,
  verificationTypeForStep,
  type FlowVerificationResource,
} from '@openverify/contracts';
import { Alert, Button, Card } from '@openverify/ui';
import { useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react';
import { normalizeDigits } from '@openverify/flow-spec';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../session/use-intl-locale';
import { errorMessageKey } from '../../api/error-message';
import { FlowApiError, type FlowApiClient } from '../../api/flow-api-client';
import { isConflict } from '../../api/problem-members';
import { FormField } from '../../components/form-field';
import { RetryHints } from '../../components/retry-hints';
import { SelectField } from '../../components/select-field';
import type {
  AamvaStep,
  BusinessWebsiteStep,
  DatabaseBusinessStep,
  DatabaseStep,
  FlowPosition,
} from '../../flow/flow-position';
import { newSubmissionProgress, type VerificationApiType } from '../../flow/submit-verification';
import { useVerificationGuidance } from '../../flow/use-verification-guidance';
import {
  aamvaFields,
  businessBody,
  businessCrossErrors,
  businessFields,
  businessRequiredMembers,
  checkFields,
  collectsPersons,
  databaseFields,
  databaseRequiredMembers,
  fieldKeyOfPointer,
  memberOfPointer,
  personFields,
  registrationFormat,
  sentValue,
  websiteFields,
  type FieldError,
  type FieldSpec,
} from './fields';
import { countryOptions, jurisdictionOptions } from './regions';

/**
 * A step the user fills in (C52.3): a database step, an AAMVA step with `source: form`, a business
 * registry step or a business website step.
 */
export type EnteredValuesFlowStep =
  DatabaseStep | AamvaStep | DatabaseBusinessStep | BusinessWebsiteStep;

/** The API type a form step's verification is created with (C50.1). */
function apiTypeOf(step: EnteredValuesFlowStep): VerificationApiType {
  const type = verificationTypeForStep(step.type);
  if (type === null) {
    throw new TypeError(`${step.type} makes no verification`);
  }
  return toApiVerificationType(type);
}

/** The form types' flow resources, whose `inputs-received` says the values arrived (C52.2). */
const FORM_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  'verification/database',
  'verification/aamva',
  'verification/database-business',
  'verification/business-website',
]);

export interface EnteredValuesStepProps {
  readonly position: Extract<FlowPosition, { kind: 'capture' }> & {
    readonly step: EnteredValuesFlowStep;
  };
  readonly client: FlowApiClient;
  /** Reloads the session once the verification is submitted, or moved on at the server. */
  readonly onSubmitted: () => Promise<void>;
  /**
   * C148.7 (Workflow 9A; 3.3.7): the session's `values`, a field the person entered earlier that this
   * step prefills from (`prefillFrom`), shown filled and editable.
   */
  readonly prefill?: Readonly<Record<string, unknown>>;
}

/** What the form says above its fields: some are marked, or the server refused unnamed ones. */
type Summary = 'invalid' | 'refused';

/** The focus target of the button that adds a person. */
const ADD_PERSON = 'add-person';

/** C52.2: whether the server already holds this attempt's values (`inputs-received`). */
function inputsReceived(verification: FlowVerificationResource | undefined): boolean {
  if (verification === undefined || !FORM_RESOURCE_TYPES.has(verification.type)) {
    return false;
  }
  return (
    (verification.attributes as { readonly 'inputs-received'?: boolean })['inputs-received'] ===
    true
  );
}

/** A 400 (the route's body schema) or 422 (the type's rules) answer about the entered values. */
function refusedValues(error: unknown): error is FlowApiError {
  return (
    error instanceof FlowApiError &&
    error.kind === 'http' &&
    (error.status === 400 || error.status === 422)
  );
}

/** The fields a step's form asks for, the business's people aside. */
function stepFields(
  step: EnteredValuesFlowStep,
  verification: FlowVerificationResource | undefined,
): FieldSpec[] {
  switch (step.type) {
    case 'database':
      return databaseFields(step, databaseRequiredMembers(step, verification));
    case 'aamva':
      return aamvaFields();
    case 'database_business':
      return businessFields(businessRequiredMembers(verification));
    case 'business_website':
      return websiteFields();
  }
}

/**
 * One attempt of a step the user fills in (C52.3, C64.1): a database step, the AAMVA form, a
 * business registry step (with its people, when the step collects them) or a business website
 * step. Each value is checked in the browser with its member's contract schema, and a business's
 * registration number and LEI with the body's own rules; then the values go to the inputs route
 * without the empty ones and the verification is submitted. A business step's verification is made
 * when the screen opens, to read which inputs every match group needs (C52.2); the others' with
 * the first send, reused for a retry. A refusal's JSON Pointers are shown at their fields; a 409
 * means the verification moved on, so the session is read again. A resumed attempt whose values
 * the server already holds can be sent for checking without typing them again.
 */
/**
 * C148.7 (3.3.7): the values a `prefillFrom` step shows on arrival. The client view leaves out the
 * step's map of inputs to fields, so a value lands at the input whose field name it carries
 * (`phone_number` at `phone-number`); a string only.
 */
function prefilledValues(
  fields: readonly FieldSpec[],
  prefill: Readonly<Record<string, unknown>> | undefined,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const value = prefill?.[field.name.replaceAll('-', '_')];
    if (typeof value === 'string') {
      values[field.name] = value;
    }
  }
  return values;
}

/** C161.4: the kinds whose typed Arabic-Indic digits become ASCII. */
const DIGIT_KINDS: ReadonlySet<FieldSpec['kind']> = new Set(['date', 'tel', 'text']);

export function EnteredValuesStep({
  position,
  client,
  onSubmitted,
  prefill,
}: EnteredValuesStepProps) {
  const { t } = useTranslation();
  const intlTag = useIntlLocale();
  const language = intlTag;
  const { step, attempt, maxAttempts, hints, verificationId } = position;
  const business = step.type === 'database_business' ? step : null;
  // One progress record per attempt, shared by the guidance read and the values' send.
  const [progress] = useState(() => newSubmissionProgress(verificationId));
  const guided = useVerificationGuidance({
    client,
    type: apiTypeOf(step),
    progress,
    verification: position.verification,
    eager: business !== null,
  });
  const { verification } = guided;
  const fields = useMemo(() => stepFields(step, verification), [step, verification]);
  const persons = business !== null && collectsPersons(business, verification);
  const countries = useMemo(() => countryOptions(language), [language]);
  const jurisdictions = useMemo(() => jurisdictionOptions(language), [language]);

  const [values, setValues] = useState<Readonly<Record<string, string>>>(() =>
    prefilledValues(stepFields(step, position.verification), prefill),
  );
  const [errors, setErrors] = useState<Readonly<Record<string, FieldError>>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failure, setFailure] = useState<{ readonly error: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  /** The associated persons on the form, by an ID that stays while others are removed. */
  const [personIds, setPersonIds] = useState<readonly number[]>([]);
  const nextPersonId = useRef(0);
  /** Bumped to move focus to the first marked field once it is rendered. */
  const [focusRequest, setFocusRequest] = useState(0);
  /** A control to focus once rendered: a new person's first name, or the add button. */
  const [focusTarget, setFocusTarget] = useState<{
    readonly name: string;
    readonly serial: number;
  } | null>(null);
  const moveFocus = (name: string) => {
    setFocusTarget((current) => ({ name, serial: (current?.serial ?? 0) + 1 }));
  };
  const controller = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const addPersonRef = useRef<HTMLButtonElement>(null);
  const received = verificationId !== null && inputsReceived(position.verification);
  const allFields = useMemo(
    () => [...fields, ...(persons ? personIds.flatMap((id) => personFields(id)) : [])],
    [fields, persons, personIds],
  );

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  // The first marked field takes focus, so a screen reader reads its error with it; a refusal
  // that names no field on the screen moves focus to the summary that says so (WCAG 3.3.1).
  useEffect(() => {
    if (focusRequest > 0) {
      (
        form.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? summaryRef.current
      )?.focus();
    }
  }, [focusRequest]);

  // A person added gets focus on their first name; once one is removed, the add button has it.
  useEffect(() => {
    if (focusTarget?.name === ADD_PERSON) {
      addPersonRef.current?.focus();
    } else if (focusTarget !== null) {
      form.current?.querySelector<HTMLElement>(`[data-field="${focusTarget.name}"]`)?.focus();
    }
  }, [focusTarget]);

  const nextRequest = () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    return { signal: current.signal, aborted: () => current.signal.aborted };
  };

  const markFields = (marked: Record<string, FieldError>) => {
    setErrors(marked);
    setSummary('invalid');
    setFocusRequest((count) => count + 1);
  };

  /** The form state's key a refusal's pointer names, when that field is on the screen. */
  const fieldOfPointer = (pointer: string): string | null =>
    business === null ? memberOfPointer(pointer) : fieldKeyOfPointer(pointer, personIds);

  /** Shows a refusal at the fields its pointers name; a 409 reads the session again. */
  const refused = async (error: unknown) => {
    if (refusedValues(error)) {
      const shown = new Map(allFields.map((field) => [field.name, field]));
      const marked: Record<string, FieldError> = {};
      for (const { pointer } of error.problem?.errors ?? []) {
        const name = fieldOfPointer(pointer);
        const field = name === null ? undefined : shown.get(name);
        if (name !== null && field !== undefined) {
          // C52.3: a business member every match group needs, left empty, is asked for.
          const empty = sentValue(field, values[name] ?? '') === '';
          marked[name] = business !== null && empty ? { key: 'required' } : { key: 'refused' };
        }
      }
      if (Object.keys(marked).length > 0) {
        markFields(marked);
      } else {
        setErrors({});
        setSummary('refused');
        setFocusRequest((count) => count + 1);
      }
    } else if (isConflict(error)) {
      // The verification or the inquiry moved on, perhaps in another window.
      await onSubmitted();
    } else {
      setFailure({ error });
    }
  };

  /** Runs one request; a failure is shown where the user can act on it. */
  const run = async (request: (signal: AbortSignal) => Promise<void>) => {
    const { signal, aborted } = nextRequest();
    setBusy(true);
    setFailure(null);
    try {
      await request(signal);
    } catch (error: unknown) {
      if (!aborted()) {
        await refused(error);
      }
      return;
    } finally {
      if (!aborted()) {
        setBusy(false);
      }
    }
    await onSubmitted();
  };

  const sendValues = async () => {
    const checked = checkFields(allFields, values);
    const marked = {
      ...(business === null ? {} : businessCrossErrors(checked.body)),
      ...checked.errors,
    };
    if (Object.keys(marked).length > 0) {
      setFailure(null);
      markFields(marked);
      return;
    }
    setErrors({});
    setSummary(null);
    const body = business === null ? checked.body : businessBody(checked.body, personIds);
    await run(async (signal) => {
      const id = await guided.verificationId(signal);
      // The body is checked member by member above; the server checks it again as a whole.
      await client.enterInputs(id, body, signal);
      await client.submitVerification(id, signal);
    });
  };

  const sendReceived = async (id: string) => {
    setErrors({});
    setSummary(null);
    await run(async (signal) => {
      await client.submitVerification(id, signal);
    });
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!busy) {
      void sendValues();
    }
  };

  const errorText = (field: FieldSpec): string | undefined => {
    const error = errors[field.name];
    switch (error?.key) {
      case undefined:
        return undefined;
      case 'required':
        return t(`forms.required.${field.message}`);
      case 'tooLong':
        return t('forms.errors.tooLong', { max: error.max });
      case 'format':
        if (field.format === 'registration') {
          return t(`forms.errors.${registrationFormat(values['country-code'])}`);
        }
        return t(
          field.format === undefined ? 'forms.errors.refused' : `forms.errors.${field.format}`,
        );
      case 'refused':
        return t('forms.errors.refused');
    }
  };

  /** A field's help: a registration number's says the chosen country's register's format. */
  const hintText = (field: FieldSpec): string | undefined => {
    if (field.format === 'registration') {
      return t(`forms.hints.${registrationFormat(values['country-code'])}`);
    }
    return field.hint === undefined ? undefined : t(`forms.hints.${field.hint}`);
  };

  const setValue = (name: string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
  };

  const addPerson = () => {
    if (personIds.length >= MAX_ASSOCIATED_PERSONS) {
      return;
    }
    const id = nextPersonId.current;
    nextPersonId.current += 1;
    setPersonIds((current) => [...current, id]);
    moveFocus(personFields(id)[0]?.name ?? ADD_PERSON);
  };

  const removePerson = (id: number) => {
    const removed = new Set(personFields(id).map((field) => field.name));
    const keep = <T,>(record: Readonly<Record<string, T>>) =>
      Object.fromEntries(Object.entries(record).filter(([name]) => !removed.has(name)));
    setPersonIds((current) => current.filter((candidate) => candidate !== id));
    setValues(keep);
    setErrors(keep);
    moveFocus(ADD_PERSON);
  };

  const control = (field: FieldSpec) => {
    const label = t(`forms.fields.${field.message}`);
    const value = values[field.name] ?? '';
    if (field.kind === 'country' || field.kind === 'state') {
      return (
        <SelectField
          key={field.name}
          data-field={field.name}
          label={label}
          options={field.kind === 'country' ? countries : jurisdictions}
          placeholder={t(field.kind === 'country' ? 'forms.chooseCountry' : 'forms.chooseState')}
          required={field.required}
          error={errorText(field)}
          autoComplete={field.autoComplete}
          value={value}
          onChange={(event) => {
            setValue(field.name, event.target.value);
          }}
        />
      );
    }
    const identifier = field.format === 'registration' || field.format === 'lei';
    return (
      <FormField
        key={field.name}
        data-field={field.name}
        label={label}
        required={field.required}
        description={hintText(field)}
        error={errorText(field)}
        type={field.kind}
        autoComplete={field.autoComplete}
        {...(field.kind === 'tel' ? { inputMode: 'tel' as const } : {})}
        {...(field.kind === 'email'
          ? { inputMode: 'email' as const, autoCapitalize: 'none', spellCheck: false }
          : {})}
        {...(field.kind === 'url'
          ? { inputMode: 'url' as const, autoCapitalize: 'none', spellCheck: false }
          : {})}
        {...(identifier ? { autoCapitalize: 'characters', spellCheck: false } : {})}
        value={value}
        onChange={(event) => {
          const typed = event.target.value;
          setValue(field.name, DIGIT_KINDS.has(field.kind) ? normalizeDigits(typed) : typed);
        }}
      />
    );
  };

  const address = fields.filter((field) => field.address);
  const groupAt = fields.findIndex((field) => field.address);
  const controls = fields.flatMap((field, index) => {
    if (!field.address) {
      return [control(field)];
    }
    return index === groupAt
      ? [
          <fieldset key="address" className="flex flex-col gap-4">
            <legend className="mb-2 text-base font-semibold text-ink">
              {t(business === null ? 'forms.address' : 'forms.businessAddress')}
            </legend>
            {address.map(control)}
          </fieldset>,
        ]
      : [];
  });

  return (
    <Card title={t(`forms.${step.type}.title`)} headingLevel={1}>
      <form ref={form} noValidate onSubmit={submit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p>{t(`forms.${step.type}.intro`)}</p>
          <p className="text-sm font-medium text-ink-muted">
            {t('attempt', { current: attempt, max: maxAttempts })}
          </p>
        </div>
        <RetryHints hints={hints} photos={false} />
        {received && (
          <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
            <p>{t('forms.received')}</p>
            <Button
              variant="secondary"
              className="aria-disabled:cursor-progress sm:self-start"
              aria-disabled={busy ? true : undefined}
              onClick={() => {
                if (!busy) {
                  void sendReceived(verificationId);
                }
              }}
            >
              {t('forms.sendReceived')}
            </Button>
          </div>
        )}
        {summary !== null && (
          <Alert ref={summaryRef} tabIndex={-1} tone="error">
            {t(summary === 'invalid' ? 'forms.invalid' : 'forms.refused')}
          </Alert>
        )}
        <p className="text-sm text-ink-muted">{t('forms.requiredNote')}</p>
        <div className="flex flex-col gap-4">{controls}</div>
        {persons && (
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-2 text-base font-semibold text-ink">
              {t('forms.persons.legend')}
            </legend>
            <p className="text-sm text-ink-muted">
              {t('forms.persons.intro', { max: MAX_ASSOCIATED_PERSONS })}
            </p>
            {personIds.map((id, index) => (
              <fieldset key={id} className="flex flex-col gap-4 rounded-lg border border-line p-4">
                <legend className="px-1 text-sm font-semibold text-ink">
                  {t('forms.persons.person', { number: index + 1 })}
                </legend>
                {personFields(id).map(control)}
                <Button
                  variant="secondary"
                  className="sm:self-start"
                  aria-disabled={busy ? true : undefined}
                  onClick={() => {
                    if (!busy) {
                      removePerson(id);
                    }
                  }}
                >
                  {t('forms.persons.remove', { number: index + 1 })}
                </Button>
              </fieldset>
            ))}
            {personIds.length < MAX_ASSOCIATED_PERSONS ? (
              <Button
                ref={addPersonRef}
                variant="secondary"
                className="sm:self-start"
                aria-disabled={busy ? true : undefined}
                onClick={() => {
                  if (!busy) {
                    addPerson();
                  }
                }}
              >
                {t('forms.persons.add')}
              </Button>
            ) : (
              <p className="text-sm text-ink-muted">{t('forms.persons.full')}</p>
            )}
          </fieldset>
        )}
        {failure !== null && <Alert tone="error">{t(errorMessageKey(failure.error))}</Alert>}
        {busy && <p role="status">{t('forms.sending')}</p>}
        <Button
          type="submit"
          className="aria-disabled:cursor-progress sm:self-end"
          // Not `disabled`: a disabled button loses focus.
          aria-disabled={busy ? true : undefined}
        >
          {t('forms.continue')}
        </Button>
      </form>
    </Card>
  );
}
