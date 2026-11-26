'use client';

/**
 * One check's panel (C153.1; ADR 0002): its tier, type, stage with the beta badge and default
 * requirement from the registry, what its result does in this draft (it decides, it runs without
 * deciding, a branch reads it, or it does not run), its run and require switches, its settings
 * generated from the registry's `configSchema`, and the branch routes of the draft that read it
 * (review H07). Every fact is text, never colour alone.
 */
import { useId, type ReactNode } from 'react';
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';
import { SchemaForm } from '../schema-form/schema-form';
import { checkDecision, type BranchRead, type CheckRow } from './check-panel-model';

const COPY = TEMPLATE_FORMS_COPY.checkPanels;

export interface CheckPatch {
  readonly enabled?: boolean;
  readonly required?: boolean;
  readonly config?: Record<string, unknown> | undefined;
}

export interface CheckPanelProps {
  readonly row: CheckRow;
  readonly reads: readonly BranchRead[];
  readonly editable: boolean;
  readonly onChange: (patch: CheckPatch, message: string) => void;
}

export function CheckPanel({ row, reads, editable, onChange }: CheckPanelProps): ReactNode {
  const id = useId();
  const beta = row.stage === 'beta';
  const decision = checkDecision(row, reads);
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="flex flex-col gap-2 rounded-md border border-line p-3"
    >
      <h4 id={`${id}-heading`} className="font-mono text-sm font-semibold">
        {row.id}
      </h4>
      <p className="text-xs text-ink-muted">{row.description}</p>
      <ul aria-label={COPY.facts(row.id)} className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <li>
          {COPY.tierLine(
            COPY.tier[row.tier],
            row.alternateTier === null ? '' : COPY.tier[row.alternateTier],
          )}
        </li>
        <li>{COPY.type[row.checkType]}</li>
        <li>{COPY.stage[row.stage]}</li>
        {beta && (
          <li className="inline-flex items-center gap-1 rounded border border-ink px-1 font-semibold">
            <span aria-hidden="true">β</span> <span>{COPY.betaBadge}</span>
          </li>
        )}
        <li>{COPY.defaultRequirement[row.defaultRequirement]}</li>
      </ul>
      {beta && <p className="text-xs">{COPY.betaNote}</p>}
      <p className="text-sm font-medium">{COPY.decision[decision]}</p>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex min-h-6 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-6"
            checked={row.enabled}
            disabled={!editable}
            onChange={(event) => {
              const enabled = event.currentTarget.checked;
              onChange(
                { enabled, ...(enabled ? {} : { required: false }) },
                enabled ? COPY.announce.enabled(row.id) : COPY.announce.disabled(row.id),
              );
            }}
          />
          {COPY.enabled(row.id)}
        </label>
        <label className="flex min-h-6 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-6"
            checked={row.enabled && row.required}
            disabled={!editable || !row.enabled}
            aria-describedby={row.enabled ? undefined : `${id}-required-note`}
            onChange={(event) => {
              const required = event.currentTarget.checked;
              onChange(
                { required },
                required ? COPY.announce.required(row.id) : COPY.announce.notRequired(row.id),
              );
            }}
          />
          {COPY.required(row.id)}
        </label>
        {!row.enabled && (
          <p id={`${id}-required-note`} className="text-xs text-ink-muted">
            {COPY.requiredNeedsEnabled}
          </p>
        )}
      </div>
      {row.configSchema === undefined ? (
        <p className="text-xs text-ink-muted">{COPY.configNone}</p>
      ) : (
        <SchemaForm
          legend={COPY.config(row.id)}
          schema={row.configSchema}
          value={row.config ?? {}}
          readOnly={!editable}
          onChange={(config) => {
            onChange(
              { config: Object.keys(config).length === 0 ? undefined : config },
              COPY.announce.config(row.id),
            );
          }}
        />
      )}
      <h5 id={`${id}-branches`} className="text-sm font-semibold">
        {COPY.branchesHeading(row.id)}
      </h5>
      {reads.length === 0 ? (
        <p className="text-sm">{COPY.noBranches}</p>
      ) : (
        <ul aria-labelledby={`${id}-branches`} className="list-disc ps-5 text-sm">
          {reads.map((read) => (
            <li key={`${read.stepId}:${read.routeKey}`}>
              {COPY.branchLine(read.stepName, read.routeLabel)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
