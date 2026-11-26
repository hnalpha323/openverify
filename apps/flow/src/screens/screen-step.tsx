/**
 * C148 (Workflow 9A, flow-renderer): the `screen` step. It renders the server's client view of the
 * current screen (C151.5) with the catalogue of `SCREEN_COMPONENTS`, fills each field with the value
 * the session holds (3.3.7), shows and enables components through the shared strict visibility
 * evaluator on load and on every change (C148.4), checks values only to help the person, and submits
 * the visible values with the pressed button's key (C148.5). The server decides where the flow goes.
 */
import type { Component, ScreenClientView } from '@openverify/flow-spec';
import { VisibilityRuleError } from '@openverify/flow-spec';
import { Alert, Button, Card } from '@openverify/ui';
import { useId, useMemo, useRef, useState, type ReactNode, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { FlowSessionResponse } from '@openverify/contracts';
import {
  SCREEN_COMPONENTS,
  ScreenContext,
  type ScreenComponentProps,
  type ScreenContextValue,
} from './screen-components';
import {
  allComponents,
  boundFields,
  initialScreenState,
  normalizeTyped,
  screenErrors,
  submissionValues,
  visibleComponentIds,
  type AddressPart,
  type BoundField,
  type FieldError,
  type ScreenState,
  type SubmittedValue,
  type Visibility,
} from './screen-model';

/** What a screen sends (C148.5): the visible values, and the submit button's port key. */
export interface ScreenSubmission {
  readonly values: Readonly<Record<string, SubmittedValue>>;
  /** Absent for the primary button (port `next`). */
  readonly button?: string;
}

/** The version's `https:` link fields (C162.3). */
export type ScreenLinks = ScreenContextValue['links'];

export interface ScreenStepProps {
  readonly step: ScreenClientView;
  /** The session's `values` (C151.5). */
  readonly values?: FlowSessionResponse['values'];
  /**
   * Sends the screen; resolves once the server answered, or rejects. The preview passes one that
   * sends nothing (C156.3).
   */
  readonly onSubmit: (submission: ScreenSubmission) => Promise<void>;
  /** A `cancel` button, once confirmed (C148.2). */
  readonly onCancel?: () => void;
  /** A copy key's text (C162.5), or `null` when no catalog holds it. */
  readonly copy: (key: string) => string | null;
  /**
   * WCAG 3.1.2: the language of a key's text when it differs from the page's (a fallback to the
   * default locale, C162.5), else `null`; the element showing the text carries it as `lang`.
   */
  readonly copyLanguage?: (key: string) => string | null;
  readonly links?: ScreenLinks;
  /** A theme asset as a `blob:` URL once loaded (C160.6), or `null`. */
  readonly asset?: ScreenContextValue['asset'];
  /** Fields the server refused (a 422's pointers), shown at their controls. */
  readonly refused?: readonly string[];
  /** Why the last submission failed, shown above the buttons. */
  readonly error?: ReactNode;
}

/** The first `title` text of a screen, which is its `h1` (the heading focus moves to). */
function firstTitleId(components: readonly Component[]): string | null {
  return (
    allComponents(components).find(
      (component) => component.kind === 'text' && component.variant === 'title',
    )?.id ?? null
  );
}

/** The name a field goes by in the error summary: its label, or an address part's own label. */
function labelOf(
  field: BoundField,
  copy: (key: string) => string | null,
  t: (key: `screen.address.${AddressPart}`) => string,
): string {
  const { component } = field;
  if (component.kind === 'address' && field.part !== undefined) {
    return t(`screen.address.${field.part}`);
  }
  return copy(component.labelKey) ?? '';
}

const NO_LINKS: ScreenContextValue['links'] = {};
const NO_ASSET: ScreenContextValue['asset'] = () => null;
const NO_LANGUAGE: ScreenContextValue['copyLanguage'] = () => null;

export function ScreenStep({
  step,
  values: sessionValues,
  onSubmit,
  onCancel,
  copy,
  copyLanguage = NO_LANGUAGE,
  links = NO_LINKS,
  asset = NO_ASSET,
  refused = [],
  error,
}: ScreenStepProps) {
  const { t } = useTranslation();
  const id = useId();
  const [state, setState] = useState<ScreenState>(() => initialScreenState(step, sessionValues));
  const [shown, setShown] = useState<ReadonlyMap<string, FieldError> | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const titleId = firstTitleId(step.components);

  // C148.4: on load and on every change, through the shared evaluator. A rule outside the strict
  // subset cannot be shown honestly, so the screen says it cannot be shown (never a guess).
  let visibility: Map<string, Visibility> | null;
  try {
    visibility = visibleComponentIds(step.components, state.values);
  } catch (failure: unknown) {
    if (!(failure instanceof VisibilityRuleError)) throw failure;
    visibility = null;
  }

  const fields = useMemo(() => boundFields(step), [step]);
  const errors = useMemo(() => {
    const merged = new Map(shown ?? []);
    for (const field of refused) {
      if (!merged.has(field)) merged.set(field, { code: 'refused' });
    }
    return merged;
  }, [shown, refused]);

  if (visibility === null) {
    return (
      <Card title={t('unsupported.title')} headingLevel={1}>
        <Alert tone="warning">{t('screen.unavailable')}</Alert>
      </Card>
    );
  }
  const visible = visibility;

  const context: ScreenContextValue = {
    values: state.values,
    set: state.set,
    errors,
    visibility: visible,
    busy,
    copy,
    copyLanguage,
    links,
    asset,
    controlId: (field) => `${id}-field-${field}`,
    change: (field, value) => {
      const typed = typeof value === 'string' ? normalizeTyped(field, value) : value;
      setState((current) => {
        const set = new Set(current.set);
        set.delete(field.key);
        return { values: { ...current.values, [field.key]: typed }, set };
      });
      // An error clears once the field is corrected; the rest stay until the next submit.
      if (shown?.has(field.key) === true) {
        setShown((current) => {
          if (current === null) return current;
          const next = new Map(current);
          next.delete(field.key);
          return next;
        });
      }
    },
    cancel: () => {
      setConfirming(true);
    },
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const submitter = (event.nativeEvent as { submitter?: unknown }).submitter;
    const port =
      submitter instanceof HTMLButtonElement && submitter.value !== ''
        ? submitter.value
        : undefined;
    const found = screenErrors(step, state, visible);
    setShown(found);
    if (found.size > 0) {
      // C148.7: the summary at the top, announced, with a link to each field.
      queueMicrotask(() => summary.current?.focus());
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        values: submissionValues(step, state, visible),
        ...(port === undefined ? {} : { button: port }),
      });
    } finally {
      setBusy(false);
    }
  };

  const render = (components: readonly Component[]): ReactNode =>
    components.map((component) => {
      const componentState = visible.get(component.id) ?? 'visible';
      if (componentState === 'hidden') return null;
      const View = SCREEN_COMPONENTS[component.kind] as (props: ScreenComponentProps) => ReactNode;
      return (
        <div key={component.id} data-component={component.id} data-kind={component.kind}>
          <View
            component={component}
            state={componentState}
            headingLevel={component.id === titleId ? 1 : 2}
            renderChildren={render}
          />
        </div>
      );
    });

  const summaryItems = fields.filter(
    (field, index, all) =>
      errors.has(field.key) && all.findIndex(({ key }) => key === field.key) === index,
  );
  const hasRequired = fields.some((field) => field.component.required === true);

  if (confirming) {
    return (
      <Card title={t('screen.cancel.title')} headingLevel={1}>
        <div className="flex flex-col gap-4">
          <p>{t('screen.cancel.message')}</p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false);
                onCancel?.();
              }}
            >
              {t('screen.cancel.confirm')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false);
              }}
            >
              {t('screen.cancel.keep')}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <ScreenContext.Provider value={context}>
      <Card data-screen={step.id}>
        {titleId === null && <h1 className="sr-only">{t('screen.heading')}</h1>}
        <form
          className="flex flex-col gap-6"
          noValidate
          aria-busy={busy}
          onSubmit={(event) => void submit(event)}
        >
          {summaryItems.length > 0 && (
            <div
              ref={summary}
              tabIndex={-1}
              role="alert"
              className="rounded-lg border border-s-4 border-red-300 bg-red-50 p-4 text-sm text-red-900"
            >
              <p className="font-semibold">{t('screen.summary')}</p>
              <ul className="mt-2 list-disc ps-5">
                {summaryItems.map((field) => (
                  <li key={field.key}>
                    <a
                      href={`#${context.controlId(field.key)}`}
                      className="underline underline-offset-4"
                    >
                      {labelOf(field, copy, t)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hasRequired && <p className="text-sm text-ink-muted">{t('screen.required')}</p>}
          {render(step.components)}
          {busy && <Alert tone="info">{t('screen.saving')}</Alert>}
          {error !== undefined && error !== null && <Alert tone="error">{error}</Alert>}
        </form>
      </Card>
    </ScreenContext.Provider>
  );
}
