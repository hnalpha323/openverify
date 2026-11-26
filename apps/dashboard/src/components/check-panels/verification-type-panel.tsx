'use client';

/**
 * One verification type's checks (C153.1): its type-level options, only those the contract lets
 * the type set (C153.5), the contract's own refusals of the type's configuration (C11: at least
 * one enabled, required check), and a `CheckPanel` per registry check in registry order. Every
 * change hands the whole type configuration back with a message to announce.
 */
import { verificationConfigSchema, type ApiVerificationType } from '@openverify/contracts';
import type { AnyFlow } from '@openverify/flow-spec';
import { useId, useMemo, type ReactNode } from 'react';
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';
import { jsonSchemaOf, problemsOf } from '../schema-form/model';
import { SchemaForm } from '../schema-form/schema-form';
import {
  branchesReadingChecks,
  checkRowsOf,
  typeOptionsSchema,
  withCheck,
  type TypeConfig,
} from './check-panel-model';
import { CheckPanel } from './check-panel';

const COPY = TEMPLATE_FORMS_COPY.checkPanels;

export interface VerificationTypePanelProps {
  readonly apiType: ApiVerificationType;
  /** The type's configuration; none yet reads as no check run. */
  readonly config: TypeConfig | undefined;
  /** The draft's flow, whose branches may read the checks. */
  readonly flow: AnyFlow;
  readonly editable: boolean;
  readonly onChange: (next: TypeConfig, message: string) => void;
}

export function VerificationTypePanel({
  apiType,
  config,
  flow,
  editable,
  onChange,
}: VerificationTypePanelProps): ReactNode {
  const id = useId();
  const current: TypeConfig = config ?? { checks: {} };
  const optionsSchema = useMemo(() => typeOptionsSchema(apiType), [apiType]);
  const optionNames = useMemo(
    () => Object.keys(jsonSchemaOf(optionsSchema).properties ?? {}),
    [optionsSchema],
  );
  const reads = useMemo(() => branchesReadingChecks(flow, apiType), [flow, apiType]);
  const rows = checkRowsOf(apiType, current);
  const problems = problemsOf(verificationConfigSchema, { [apiType]: current });
  const options = Object.fromEntries(
    Object.entries(current).filter(([name]) => optionNames.includes(name)),
  );

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <h3 id={`${id}-heading`} className="text-base font-semibold">
        {COPY.typeHeading(apiType)}
      </h3>
      {problems.length > 0 && (
        <div className="text-sm font-medium text-danger">
          <p>
            <span aria-hidden="true">⚠ </span>
            {COPY.typeProblems}
          </p>
          <ul className="list-disc ps-5">
            {problems.map((problem) => (
              <li key={`${problem.pointer}:${problem.detail}`}>
                {problem.pointer}: {problem.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
      {optionNames.length === 0 ? (
        <p className="text-sm">{COPY.noTypeOptions}</p>
      ) : (
        <SchemaForm
          legend={COPY.typeOptions(apiType)}
          schema={optionsSchema}
          value={options}
          readOnly={!editable}
          onChange={(next) => {
            const kept = Object.fromEntries(
              Object.entries(current).filter(([name]) => !optionNames.includes(name)),
            );
            onChange({ ...kept, ...next } as TypeConfig, COPY.announce.options(apiType));
          }}
        />
      )}
      {rows.map((row) => (
        <CheckPanel
          key={row.id}
          row={row}
          reads={reads.get(row.id) ?? []}
          editable={editable}
          onChange={(patch, message) => {
            onChange(withCheck(current, row.id, patch), message);
          }}
        />
      ))}
    </section>
  );
}
