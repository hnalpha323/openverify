/**
 * C156.4, C156.7 (Workflow 9C, `dashboard-preview`): the path simulate answers, as a list (the
 * accessible form): each step with the port it left by, the route a branch took with its condition's
 * result (true, false or unknown) and the `onNull` used, the unknown facts, waits, the notes the live
 * step record would hold, and every fact the route read with its tier, stage and source
 * ("self-asserted" for person facts, "client-reported" for client facts) and a badge for a beta
 * heuristic. Labelled simulated: it is never stored as a run or a step record, and it names the two
 * known ways simulate differs from a live inquiry (docs/flows/preview-and-simulate.md; K9-8).
 */
import { useId } from 'react';
import { PREVIEW_COPY } from '../../lib/copy/preview';
import type { TemplateSimulationDocument } from './preview-types';

export interface SimulatedPathProps {
  readonly simulation: TemplateSimulationDocument;
}

type SimulatedStep = TemplateSimulationDocument['data']['attributes']['steps'][number];

const copy = PREVIEW_COPY.path;
const words = (value: string) => value.replaceAll('_', ' ');
/** Statuses an inquiry holds before its path reaches a completion or a failure. */
const OPEN_STATUSES: readonly string[] = ['created', 'pending'];

function conditionWords(result: boolean | null): string {
  if (result === null) {
    return copy.conditionResult.null;
  }
  return result ? copy.conditionResult.true : copy.conditionResult.false;
}

export function Badge({ children }: { readonly children: string }) {
  return (
    <span className="ms-2 inline-flex items-center rounded-sm border border-control px-1.5 text-xs font-medium text-ink">
      {children}
    </span>
  );
}

function StepItem({ step }: { readonly step: SimulatedStep }) {
  const { route } = step;
  return (
    <li className="flex flex-col gap-1 border-s-2 border-line ps-3">
      <h4 className="font-medium text-ink">{`${step['step-id']} (${words(step['step-type'])})`}</h4>
      <p className="text-sm text-ink-muted">
        {step.port === null ? copy.noPort : copy.port(step.port)}
      </p>
      {route === null ? null : (
        <>
          <p className="text-sm">
            <span>{copy.route(route.key)}</span>
            {', '}
            <span>{conditionWords(route['condition-result'])}</span>
          </p>
          {route['on-null'] === null ? null : (
            <p className="text-sm">{copy.onNull(route['on-null'])}</p>
          )}
          {route['null-paths'].length === 0 ? null : (
            <p className="text-sm">{copy.nullPaths(route['null-paths'].join(', '))}</p>
          )}
        </>
      )}
      {step.waited ? <p className="text-sm">{copy.waited}</p> : null}
      {step.notes.length === 0 ? null : (
        <p className="text-sm">{copy.notes(step.notes.join(', '))}</p>
      )}
      {step.facts.length === 0 ? null : (
        <ul aria-label={copy.facts} className="list-disc ps-5 text-sm">
          {step.facts.map((fact) => (
            <li key={fact.path}>
              {`${fact.path}: ${copy.factTier(fact.tier)}, ${copy.factStage(fact.stage)}, ${copy.factSource[fact.source]}`}
              {fact.stage === 'beta' ? <Badge>{copy.beta}</Badge> : null}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Values({ label, values }: { readonly label: string; readonly values: readonly string[] }) {
  return (
    <div>
      <dt className="font-medium text-ink">{label}</dt>
      <dd>
        {values.length === 0 ? (
          <span className="text-ink-muted">{copy.none}</span>
        ) : (
          <ul className="list-disc ps-5">
            {values.map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}

export function SimulatedPath({ simulation }: SimulatedPathProps) {
  const headingId = useId();
  const outcomeId = useId();
  const { steps, outcome, halted } = simulation.data.attributes;
  const flowOutcome = outcome['flow-outcome'];
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-base font-semibold text-ink">
        {copy.heading}
      </h3>
      <p>
        <Badge>{PREVIEW_COPY.simulate.simulatedLabel}</Badge>
      </p>
      <ul aria-label={copy.differencesLabel} className="list-disc ps-5 text-sm text-ink-muted">
        <li>{copy.differences.failureStep}</li>
        <li>{copy.differences.nullSignal}</li>
      </ul>
      {halted === null ? null : (
        <p className="text-sm text-danger">
          <span aria-hidden="true">⚠ </span>
          {copy.halted(halted)}
        </p>
      )}
      {OPEN_STATUSES.includes(outcome.status) ? <p className="text-sm">{copy.pending}</p> : null}
      <ol aria-label={copy.listLabel} className="flex flex-col gap-3">
        {steps.map((step, index) => (
          <StepItem key={`${String(index)}:${step['step-id']}`} step={step} />
        ))}
      </ol>
      <section aria-labelledby={outcomeId} className="rounded-md border border-line p-3 text-sm">
        <h4 id={outcomeId} className="font-semibold text-ink">
          {copy.outcome}
        </h4>
        <p>{copy.outcomeStatus(outcome.status)}</p>
        <dl className="mt-2 flex flex-col gap-2">
          <Values
            label={copy.verificationTypes}
            values={flowOutcome['verification-types-on-path']}
          />
          <Values label={copy.fallbacks} values={flowOutcome['fallbacks-taken']} />
          <Values label={copy.flags} values={flowOutcome.flags} />
        </dl>
      </section>
    </section>
  );
}
