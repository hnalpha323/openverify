'use client';

/**
 * C156.2 (Workflow 9C, `dashboard-preview`): the preview workbench. It resolves the version through
 * `POST .../preview` (with the unsaved members it is given, for an editor that previews before it
 * saves) in the chosen locale, at most once per `PREVIEW_MIN_INTERVAL_MS`, and shows the answer in
 * the frame with the viewport, scheme, step and simulated outcome controls. A refused member is
 * shown beside its control or in the problems list, never silently dropped.
 */
import {
  PREVIEW_PSEUDO_LOCALES,
  STEP_VERIFICATION_TYPES,
  type PreviewInquiryTemplateVersionBody,
} from '@openverify/contracts';
import { Button } from '@openverify/ui';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ActionResult } from '../../lib/action-state';
import { PREVIEW_COPY } from '../../lib/copy/preview';
import { FormField } from '../form-field';
import { previewAssetUrl } from './asset-url';
import { FlowPreviewFrame } from './flow-preview-frame';
import { placeProblem, type PlacedProblem, type ProblemTarget } from './preview-problems';
import {
  PREVIEW_OUTCOMES,
  PREVIEW_SCHEMES,
  PREVIEW_VIEWPORTS,
  type PreviewOutcome,
  type PreviewScheme,
  type PreviewViewport,
} from './preview-protocol';
import type { TemplatePreviewDocument } from './preview-types';

/**
 * The shortest time between two preview calls. Provisional; basis: the `template-preview` policy
 * allows 120 calls a minute per operator, shared with validate and simulate, and one call per 0.6 s
 * is 100 a minute, which leaves room for them.
 */
export const PREVIEW_MIN_INTERVAL_MS = 600;

export type PreviewUnsaved = NonNullable<PreviewInquiryTemplateVersionBody['data']>['attributes'];

export interface PreviewResolveInput {
  readonly 'version-id': string;
  readonly body: PreviewInquiryTemplateVersionBody;
}

export interface PreviewWorkbenchProps {
  readonly templateId: string;
  readonly versionId: string;
  /** The flow origin (`previewFlowOrigin()`), or `null` when not configured. */
  readonly flowOrigin: string | null;
  /** The version's enabled locales; the pseudo-locales are added. */
  readonly locales: readonly string[];
  readonly defaultLocale: string;
  /** Unsaved members to preview instead of the stored ones (an editor's draft). */
  readonly unsaved?: PreviewUnsaved;
  /** The `resolvePreview` server action. */
  readonly resolve: (input: PreviewResolveInput) => Promise<ActionResult<TemplatePreviewDocument>>;
}

export const CONTROL_CLASS =
  'min-h-11 rounded-md border border-control bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

const PROBLEM_LABELS: Readonly<Record<Exclude<ProblemTarget, 'locale'>, string>> = {
  'theme-set': PREVIEW_COPY.problems.themeSet,
  styles: PREVIEW_COPY.problems.styles,
  flow: PREVIEW_COPY.problems.flow,
  scope: PREVIEW_COPY.problems.scope,
  preset: PREVIEW_COPY.problems.preset,
  other: PREVIEW_COPY.problems.other,
};

const isCaptureStep = (type: string): boolean =>
  Object.hasOwn(STEP_VERIFICATION_TYPES, type) &&
  STEP_VERIFICATION_TYPES[type as keyof typeof STEP_VERIFICATION_TYPES] !== null;

const localeLabel = (locale: string): string =>
  (PREVIEW_PSEUDO_LOCALES as readonly string[]).includes(locale)
    ? PREVIEW_COPY.controls.pseudoLocale(locale)
    : locale;

function RadioGroup<Value extends string | number>({
  legend,
  values,
  value,
  label,
  onChange,
}: {
  readonly legend: string;
  readonly values: readonly Value[];
  readonly value: Value;
  readonly label: (value: Value) => string;
  readonly onChange: (value: Value) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {values.map((option) => (
          <label
            key={String(option)}
            className="flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm"
          >
            <input
              type="radio"
              name={name}
              value={String(option)}
              checked={option === value}
              onChange={() => {
                onChange(option);
              }}
              className="size-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            />
            {label(option)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function PreviewWorkbench({
  templateId,
  versionId,
  flowOrigin,
  locales,
  defaultLocale,
  unsaved,
  resolve,
}: PreviewWorkbenchProps) {
  const problemsId = useId();
  const [locale, setLocale] = useState(defaultLocale);
  const [viewport, setViewport] = useState<PreviewViewport>(375);
  const [scheme, setScheme] = useState<PreviewScheme>('auto');
  const [chosenStep, setChosenStep] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, PreviewOutcome>>>({});
  const [document, setDocument] = useState<TemplatePreviewDocument | null>(null);
  const [problem, setProblem] = useState<PlacedProblem | null>(null);
  const [refreshes, setRefreshes] = useState(0);
  const lastCallRef = useRef<number | null>(null);

  const body = useMemo<PreviewInquiryTemplateVersionBody>(
    () => ({
      ...(unsaved === undefined ? {} : { data: { attributes: unsaved } }),
      meta: { locale: locale as PreviewInquiryTemplateVersionBody['meta']['locale'] },
    }),
    [unsaved, locale],
  );

  useEffect(() => {
    let current = true;
    const last = lastCallRef.current;
    const delay = last === null ? 0 : Math.max(0, last + PREVIEW_MIN_INTERVAL_MS - Date.now());
    const timer = setTimeout(() => {
      lastCallRef.current = Date.now();
      void resolve({ 'version-id': versionId, body }).then((result) => {
        if (!current) {
          return;
        }
        if (result.ok) {
          setDocument(result.data);
          setProblem(null);
        } else {
          setProblem(placeProblem(result.problem));
        }
      });
    }, delay);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [resolve, versionId, body, refreshes]);

  const assetUrl = useMemo(() => previewAssetUrl(templateId), [templateId]);
  const steps = document?.data.attributes.steps ?? [];
  const stepId = chosenStep ?? steps[0]?.id ?? null;
  const step = steps.find((candidate) => candidate.id === stepId);
  const localeOptions = [...locales, ...PREVIEW_PSEUDO_LOCALES];
  const contrast = document?.data.attributes.contrast;
  const listed = Object.entries(problem?.byTarget ?? {}).filter(([target]) => target !== 'locale');

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="flex flex-col gap-4 lg:w-80 lg:shrink-0">
        <h2 className="text-base font-semibold text-ink">{PREVIEW_COPY.controls.groupLabel}</h2>
        <RadioGroup
          legend={PREVIEW_COPY.controls.viewport}
          values={PREVIEW_VIEWPORTS}
          value={viewport}
          label={PREVIEW_COPY.controls.viewportOption}
          onChange={setViewport}
        />
        <RadioGroup
          legend={PREVIEW_COPY.controls.scheme}
          values={PREVIEW_SCHEMES}
          value={scheme}
          label={(value) => PREVIEW_COPY.controls.schemes[value]}
          onChange={setScheme}
        />
        <FormField label={PREVIEW_COPY.controls.locale} error={problem?.byTarget.locale?.join(' ')}>
          {(control) => (
            <select
              {...control}
              className={CONTROL_CLASS}
              value={locale}
              onChange={(event) => {
                setLocale(event.target.value);
              }}
            >
              {localeOptions.map((option) => (
                <option key={option} value={option}>
                  {localeLabel(option)}
                </option>
              ))}
            </select>
          )}
        </FormField>
        {steps.length === 0 ? null : (
          <FormField label={PREVIEW_COPY.controls.step}>
            {(control) => (
              <select
                {...control}
                className={CONTROL_CLASS}
                value={stepId ?? ''}
                onChange={(event) => {
                  setChosenStep(event.target.value);
                }}
              >
                {steps.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {`${candidate.id} (${candidate.type.replaceAll('_', ' ')})`}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}
        {step === undefined || !isCaptureStep(step.type) ? null : (
          <FormField label={PREVIEW_COPY.controls.outcome}>
            {(control) => (
              <select
                {...control}
                className={CONTROL_CLASS}
                value={outcomes[step.id] ?? ''}
                onChange={(event) => {
                  const value = event.target.value as PreviewOutcome | '';
                  setOutcomes((all) =>
                    Object.fromEntries([
                      ...Object.entries(all).filter(([id]) => id !== step.id),
                      ...(value === '' ? [] : [[step.id, value] as const]),
                    ]),
                  );
                }}
              >
                <option value="">{PREVIEW_COPY.controls.outcomeUnset}</option>
                {PREVIEW_OUTCOMES.map((outcome) => (
                  <option key={outcome} value={outcome}>
                    {PREVIEW_COPY.controls.outcomes[outcome]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}
        <Button
          variant="secondary"
          onClick={() => {
            setRefreshes((count) => count + 1);
          }}
        >
          {PREVIEW_COPY.controls.refresh}
        </Button>
        {contrast === undefined ? null : (
          <section aria-label={PREVIEW_COPY.contrast.heading} className="text-sm">
            <p className={contrast.status === 'failed' ? 'text-danger' : 'text-ink'}>
              <span aria-hidden="true">{contrast.status === 'failed' ? '⚠ ' : '✓ '}</span>
              {contrast.status === 'failed'
                ? PREVIEW_COPY.contrast.failed
                : PREVIEW_COPY.contrast.passed}
            </p>
            <p className="text-ink-muted">{PREVIEW_COPY.contrast.scope}</p>
          </section>
        )}
        <div aria-live="polite" className="flex flex-col gap-2">
          {problem?.rateLimited === true ? (
            <p className="text-sm text-ink">{PREVIEW_COPY.problems.rateLimited}</p>
          ) : null}
          {problem?.rateLimited !== true && listed.length > 0 ? (
            <section
              aria-labelledby={problemsId}
              className="rounded-md border border-danger p-3 text-sm"
            >
              <h3 id={problemsId} className="font-semibold text-danger">
                <span aria-hidden="true">⚠ </span>
                {PREVIEW_COPY.problems.heading}
              </h3>
              <ul className="mt-1 list-disc ps-5">
                {listed.flatMap(([target, details]) =>
                  details.map((detail) => (
                    <li key={`${target}:${detail}`}>
                      <strong>{PROBLEM_LABELS[target as Exclude<ProblemTarget, 'locale'>]}:</strong>{' '}
                      {detail}
                    </li>
                  )),
                )}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <FlowPreviewFrame
          flowOrigin={flowOrigin}
          document={document}
          assetUrl={assetUrl}
          viewport={viewport}
          scheme={scheme}
          stepId={stepId}
          outcomes={outcomes}
          onNavigated={setChosenStep}
        />
      </div>
    </div>
  );
}
