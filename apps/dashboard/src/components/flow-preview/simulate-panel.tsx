'use client';

/**
 * C156.4 (Workflow 9C, `dashboard-preview`): simulate with presets. The operator chooses what each
 * verification, check, flow-provisional signal, list, workflow and the device answer (or `null`,
 * an unknown fact), or a preset, and sees the path the engine would take (`SimulatedPath`). Every
 * preset is labelled "synthetic values only"; a built-in preset and a preset whose values the API
 * hides (no `pii:view`) are simulated by their id and never shown or offered for editing; my own
 * presets load into the form, and can be saved and deleted (after a confirmation). Nothing is stored
 * but a preset the operator saves; the path is never a run.
 */
import { DEVICE_KINDS, DEVICE_PLATFORMS } from '@openverify/flow-spec';
import { VERIFICATION_STATUSES } from '@openverify/core';
import type {
  SimulatedScope,
  SimulateInquiryTemplateVersionBody,
  SimulationPresetResource,
} from '@openverify/contracts';
import { Button } from '@openverify/ui';
import { useId, useState, type ReactNode } from 'react';
import type { ActionResult } from '../../lib/action-state';
import { PREVIEW_COPY } from '../../lib/copy/preview';
import { ConfirmDialog } from '../confirm-dialog';
import { FormField } from '../form-field';
import { placeProblem, type PlacedProblem } from './preview-problems';
import type { TemplateSimulationDocument } from './preview-types';
import { CONTROL_CLASS } from './preview-workbench';
import {
  emptyScopeForm,
  formOfScope,
  scopeOfForm,
  type ScopeForm,
  type ScopeSubjects,
} from './scope-form-model';
import { SimulatedPath } from './simulated-path';

export interface SimulatePanelProps {
  readonly versionId: string;
  readonly subjects: ScopeSubjects;
  /** The built-in presets first, then the operator's own, as the API lists them. */
  readonly presets: readonly SimulationPresetResource[];
  /** The `runSimulation` server action. */
  readonly simulate: (input: {
    readonly 'version-id': string;
    readonly body: SimulateInquiryTemplateVersionBody;
  }) => Promise<ActionResult<TemplateSimulationDocument>>;
  /** The `savePreset` server action. */
  readonly save: (input: {
    readonly name: string;
    readonly scope: SimulatedScope;
  }) => Promise<ActionResult<SimulationPresetResource>>;
  /** The `removePreset` server action. */
  readonly remove: (input: { readonly id: string }) => Promise<ActionResult>;
}

const copy = PREVIEW_COPY.simulate;
const TEXTAREA_CLASS = `${CONTROL_CLASS} min-h-20 py-2 font-mono`;
/** The statuses offered first: the three C156.4 names, then every other verification status. */
const STATUS_OPTIONS: readonly string[] = [
  'passed',
  'failed',
  'needs_review',
  ...VERIFICATION_STATUSES.filter(
    (status) => status !== 'passed' && status !== 'failed' && status !== 'needs_review',
  ),
];
const WORKFLOW_STATUSES = ['completed', 'errored', 'canceled', 'timed-out'] as const;

const presetLabel = (preset: SimulationPresetResource): string =>
  `${preset.attributes.name} (${preset.attributes['built-in'] ? `${copy.builtIn}, ` : ''}${copy.presetLabel})`;

/** Whether the form can hold the preset's values: my own preset whose values the API served. */
const editable = (preset: SimulationPresetResource | undefined): boolean =>
  preset === undefined || (!preset.attributes['built-in'] && preset.attributes.scope !== null);

function Select({
  label,
  value,
  onChange,
  children,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly children: ReactNode;
}) {
  return (
    <FormField label={label}>
      {(control) => (
        <select
          {...control}
          className={CONTROL_CLASS}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {children}
        </select>
      )}
    </FormField>
  );
}

function TextArea({
  label,
  value,
  description,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly description?: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <FormField label={label} {...(description === undefined ? {} : { description })}>
      {(control) => (
        <textarea
          {...control}
          className={TEXTAREA_CLASS}
          value={value}
          spellCheck={false}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      )}
    </FormField>
  );
}

function ScopeFields({
  subjects,
  form,
  update,
}: {
  readonly subjects: ScopeSubjects;
  readonly form: ScopeForm;
  readonly update: (change: (draft: ScopeForm) => void) => void;
}) {
  const legend = 'text-sm font-semibold text-ink';
  return (
    <div className="flex flex-col gap-4">
      {subjects.verifications.length === 0 ? null : (
        <fieldset className="flex flex-col gap-3">
          <legend className={legend}>{copy.verifications}</legend>
          {subjects.verifications.map(({ id }) => {
            const entry = form.verifications[id] ?? { status: '', checks: '', extractions: '' };
            return (
              <div key={id} className="flex flex-col gap-2 border-s-2 border-line ps-3">
                <Select
                  label={`${id}: ${copy.verificationStatus}`}
                  value={entry.status}
                  onChange={(status) => {
                    update((draft) => {
                      draft.verifications[id] = { ...entry, status };
                    });
                  }}
                >
                  <option value="">{copy.verificationStatusOption.unset}</option>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status.replaceAll('_', ' ')}
                    </option>
                  ))}
                  <option value="null">{copy.verificationStatusOption.null}</option>
                </Select>
                <TextArea
                  label={`${id}: ${copy.checks}`}
                  description={copy.checksHint}
                  value={entry.checks}
                  onChange={(checks) => {
                    update((draft) => {
                      draft.verifications[id] = { ...entry, checks };
                    });
                  }}
                />
                <TextArea
                  label={`${id}: ${copy.extractions}`}
                  value={entry.extractions}
                  onChange={(extractions) => {
                    update((draft) => {
                      draft.verifications[id] = { ...entry, extractions };
                    });
                  }}
                />
              </div>
            );
          })}
        </fieldset>
      )}
      {subjects.signals.length === 0 ? null : (
        <fieldset className="flex flex-col gap-3">
          <legend className={legend}>{copy.signals}</legend>
          <p className="text-sm text-ink-muted">{copy.signalsHint}</p>
          {subjects.signals.map(({ name }) => {
            const entry = form.signals[name] ?? { mode: '', value: '' };
            return (
              <div key={name} className="flex flex-col gap-2">
                <Select
                  label={`${name}: ${copy.signalState}`}
                  value={entry.mode}
                  onChange={(mode) => {
                    update((draft) => {
                      draft.signals[name] = { ...entry, mode: mode as typeof entry.mode };
                    });
                  }}
                >
                  <option value="">{copy.signalModes.unset}</option>
                  <option value="null">{copy.signalModes.null}</option>
                  <option value="set">{copy.signalModes.set}</option>
                </Select>
                {entry.mode === 'set' ? (
                  <FormField label={`${name}: ${copy.signalValue}`}>
                    {(control) => (
                      <input
                        {...control}
                        className={CONTROL_CLASS}
                        value={entry.value}
                        onChange={(event) => {
                          const value = event.target.value;
                          update((draft) => {
                            draft.signals[name] = { ...entry, value };
                          });
                        }}
                      />
                    )}
                  </FormField>
                ) : null}
              </div>
            );
          })}
        </fieldset>
      )}
      {subjects.lists.length === 0 ? null : (
        <fieldset className="flex flex-col gap-3">
          <legend className={legend}>{copy.lists}</legend>
          {subjects.lists.map((list) => (
            <Select
              key={list}
              label={copy.listLabel(list)}
              value={form.lists[list] ?? ''}
              onChange={(choice) => {
                update((draft) => {
                  draft.lists[list] = choice as ScopeForm['lists'][string];
                });
              }}
            >
              <option value="">{copy.listOptions.unset}</option>
              <option value="matched">{copy.listOptions.matched}</option>
              <option value="none">{copy.listOptions.none}</option>
              <option value="null">{copy.listOptions.null}</option>
            </Select>
          ))}
        </fieldset>
      )}
      {subjects.workflows.length === 0 ? null : (
        <fieldset className="flex flex-col gap-3">
          <legend className={legend}>{copy.workflows}</legend>
          {subjects.workflows.map(({ id }) => {
            const entry = form.workflows[id] ?? { status: '', errorType: '', outputs: '' };
            return (
              <div key={id} className="flex flex-col gap-2 border-s-2 border-line ps-3">
                <Select
                  label={`${id}: ${copy.workflowStatus}`}
                  value={entry.status}
                  onChange={(status) => {
                    update((draft) => {
                      draft.workflows[id] = { ...entry, status };
                    });
                  }}
                >
                  <option value="">{copy.verificationStatusOption.unset}</option>
                  {WORKFLOW_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </Select>
                <FormField label={`${id}: ${copy.workflowErrorType}`}>
                  {(control) => (
                    <input
                      {...control}
                      className={CONTROL_CLASS}
                      value={entry.errorType}
                      onChange={(event) => {
                        const errorType = event.target.value;
                        update((draft) => {
                          draft.workflows[id] = { ...entry, errorType };
                        });
                      }}
                    />
                  )}
                </FormField>
                <TextArea
                  label={`${id}: ${copy.workflowOutputs}`}
                  value={entry.outputs}
                  onChange={(outputs) => {
                    update((draft) => {
                      draft.workflows[id] = { ...entry, outputs };
                    });
                  }}
                />
              </div>
            );
          })}
        </fieldset>
      )}
      <fieldset className="flex flex-col gap-3">
        <legend className={legend}>{copy.device}</legend>
        <Select
          label={copy.deviceKind}
          value={form.device.kind}
          onChange={(kind) => {
            update((draft) => {
              draft.device = { ...draft.device, kind };
            });
          }}
        >
          <option value="">{copy.deviceUnset}</option>
          {DEVICE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
          <option value="null">{copy.deviceNull}</option>
        </Select>
        <Select
          label={copy.devicePlatform}
          value={form.device.platform}
          onChange={(platform) => {
            update((draft) => {
              draft.device = { ...draft.device, platform };
            });
          }}
        >
          <option value="">{copy.deviceUnset}</option>
          {DEVICE_PLATFORMS.map((platform) => (
            <option key={platform} value={platform}>
              {platform}
            </option>
          ))}
          <option value="null">{copy.deviceNull}</option>
        </Select>
      </fieldset>
      <FormField label={copy.inquiryTags}>
        {(control) => (
          <input
            {...control}
            className={CONTROL_CLASS}
            value={form.tags}
            onChange={(event) => {
              const tags = event.target.value;
              update((draft) => {
                draft.tags = tags;
              });
            }}
          />
        )}
      </FormField>
      <TextArea
        label={copy.fields}
        value={form.fields}
        onChange={(fields) => {
          update((draft) => {
            draft.fields = fields;
          });
        }}
      />
    </div>
  );
}

export function SimulatePanel({
  versionId,
  subjects,
  presets: initialPresets,
  simulate,
  save,
  remove,
}: SimulatePanelProps) {
  const headingId = useId();
  const [presets, setPresets] = useState(initialPresets);
  const [presetId, setPresetId] = useState('');
  const [form, setForm] = useState<ScopeForm>(() => emptyScopeForm(subjects));
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [problem, setProblem] = useState<PlacedProblem | null>(null);
  const [result, setResult] = useState<TemplateSimulationDocument | null>(null);
  const [pending, setPending] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);

  const preset = presets.find((candidate) => candidate.id === presetId);
  const formShown = editable(preset);
  const update = (change: (draft: ScopeForm) => void) => {
    setForm((current) => {
      const draft = structuredClone(current);
      change(draft);
      return draft;
    });
  };

  const choosePreset = (id: string) => {
    setPresetId(id);
    setMessage('');
    const chosen = presets.find((candidate) => candidate.id === id);
    const scope = chosen?.attributes.scope;
    if (chosen !== undefined && editable(chosen) && scope !== null && scope !== undefined) {
      setForm(formOfScope(scope, subjects));
    }
  };

  const scopeOrErrors = (): SimulatedScope | null => {
    const built = scopeOfForm(form);
    if (!built.ok) {
      setErrors(built.errors.map(({ message: text }) => text));
      return null;
    }
    setErrors([]);
    return built.scope;
  };

  const run = async () => {
    setMessage('');
    let body: SimulateInquiryTemplateVersionBody;
    if (preset !== undefined && !formShown) {
      body = { meta: { 'preset-id': preset.id } };
    } else {
      const scope = scopeOrErrors();
      if (scope === null) {
        return;
      }
      body = { meta: { scope } };
    }
    setPending(true);
    const answer = await simulate({ 'version-id': versionId, body });
    setPending(false);
    if (answer.ok) {
      setResult(answer.data);
      setProblem(null);
    } else {
      setResult(null);
      setProblem(placeProblem(answer.problem));
    }
  };

  const saveAsPreset = async () => {
    setMessage('');
    const scope = scopeOrErrors();
    if (scope === null) {
      return;
    }
    const answer = await save({ name, scope });
    if (answer.ok) {
      setPresets((all) => [...all, answer.data]);
      setName('');
      setMessage(copy.saved);
    } else {
      setProblem(placeProblem(answer.problem));
    }
  };

  const deletePreset = async () => {
    if (preset === undefined) {
      return;
    }
    const answer = await remove({ id: preset.id });
    setConfirming(false);
    if (answer.ok) {
      setPresets((all) => all.filter((candidate) => candidate.id !== preset.id));
      setPresetId('');
      setMessage(copy.deleted);
    } else {
      setProblem(placeProblem(answer.problem));
    }
  };

  const problems = Object.values(problem?.byTarget ?? {}).flat();

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="text-lg font-semibold text-ink">
        {copy.heading}
      </h2>
      <p className="text-sm text-ink-muted">{copy.description}</p>
      <p className="text-sm font-medium text-ink">
        <span aria-hidden="true">ⓘ </span>
        {copy.syntheticOnly}
      </p>
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex flex-col gap-4 lg:w-96 lg:shrink-0">
          <Select label={copy.preset} value={presetId} onChange={choosePreset}>
            <option value="">{copy.noPreset}</option>
            {presets.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {presetLabel(candidate)}
              </option>
            ))}
          </Select>
          {preset?.attributes['built-in'] === true ? (
            <p className="text-sm text-ink-muted">{`${copy.builtIn}: ${copy.presetLabel}`}</p>
          ) : null}
          {preset !== undefined && !preset.attributes['built-in'] && !formShown ? (
            <p className="text-sm text-ink">{copy.scopeHidden}</p>
          ) : null}
          {preset !== undefined && !preset.attributes['built-in'] ? (
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(true);
              }}
            >
              {copy.deletePreset}
            </Button>
          ) : null}
          {formShown ? <ScopeFields subjects={subjects} form={form} update={update} /> : null}
          <div aria-live="polite" className="flex flex-col gap-1 text-sm">
            {errors.length === 0 && problems.length === 0 ? null : (
              <div className="rounded-md border border-danger p-3">
                <p className="font-semibold text-danger">
                  <span aria-hidden="true">⚠ </span>
                  {copy.formInvalid}
                </p>
                <ul className="list-disc ps-5">
                  {[...errors, ...problems].map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              </div>
            )}
            {message === '' ? null : <p role="status">{message}</p>}
          </div>
          <Button disabled={pending} onClick={() => void run()}>
            {pending ? copy.running : copy.run}
          </Button>
          {formShown ? (
            <div className="flex flex-col gap-2">
              <FormField label={copy.presetName}>
                {(control) => (
                  <input
                    {...control}
                    className={CONTROL_CLASS}
                    value={name}
                    maxLength={100}
                    onChange={(event) => {
                      setName(event.target.value);
                    }}
                  />
                )}
              </FormField>
              <Button
                variant="secondary"
                disabled={name.trim() === ''}
                onClick={() => void saveAsPreset()}
              >
                {copy.savePreset}
              </Button>
            </div>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          {result === null ? null : <SimulatedPath simulation={result} />}
        </div>
      </div>
      <ConfirmDialog
        open={confirming && preset !== undefined}
        title={copy.deleteConfirm(preset?.attributes.name ?? '')}
        confirmLabel={copy.deletePreset}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => void deletePreset()}
      />
    </section>
  );
}
