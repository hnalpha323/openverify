/**
 * The C107.7 fieldsets of the settings form (C90.8, C91.7, C96.1, C97.4, C101, C102.7, C105.5,
 * C108). A setting the server does not report is left out, so the form never posts it. The privacy
 * members (the collection tiers, the biometric lists basis and the graph switches) are editable
 * only with `settings:privacy`; without it they show read-only and are never posted, because the
 * API refuses the whole save. A checkbox posts a `<name>-shown` marker beside it, so an unchecked
 * box reads as off and an absent one as not shown.
 */
import {
  DEVICE_RECOGNITION_MODES,
  SESSION_INTEGRITY_MODES,
  type DashboardSettings,
  type EnvironmentKind,
} from '@openverify/contracts';
import { Checkbox, Field, Input } from '@openverify/ui';
import { fieldErrorOf, type DisplayProblem } from '../../lib/action-state';
import { FormField, controlClassName } from '../form-field';
import { CollectionDetails, GraphSwitchDetails, PRIVACY_NOTE } from './phase7-settings-view';
import {
  BIOMETRIC_BASIS_FIELD,
  DEVICE_RECOGNITION_LABELS,
  DISPLAY_NAME_FIELD,
  ENVIRONMENT_NAMES,
  GRAPH_QUERY_RETENTION_FIELD,
  GRAPH_SWITCHES,
  SESSION_INTEGRITY_LABELS,
  SIGNAL_WINDOW_FIELDS,
  TRANSACTION_RETENTION_FIELD,
  WINDOW_FIELDS,
  type WindowField,
} from './settings-fields';

/** The pointers these fieldsets show their errors at. */
export const PHASE7_POINTERS: readonly string[] = [
  '/signal-collection',
  '/signal-collection/session-integrity',
  '/signal-collection/device-recognition',
  '/signal-collection/device-recognition-basis',
  '/expose-signals',
  ...WINDOW_FIELDS.map((field) => `/${field.name}`),
  `/${DISPLAY_NAME_FIELD.name}`,
  `/${BIOMETRIC_BASIS_FIELD.name}`,
  ...GRAPH_SWITCHES.map((field) => `/${field.name}`),
];

const FIELDSET = 'flex flex-col gap-4 rounded-xl border border-line bg-surface p-6';
const LEGEND = 'px-1 text-lg font-semibold text-ink';

function WindowInput({
  field,
  value,
  problem,
}: {
  readonly field: WindowField;
  readonly value: number | null;
  readonly problem: DisplayProblem | undefined;
}) {
  return (
    <Field
      label={field.label}
      description={field.description}
      error={fieldErrorOf(problem, `/${field.name}`)}
    >
      <Input
        type="number"
        name={field.name}
        inputMode="numeric"
        min={field.min}
        max={field.max}
        step={1}
        defaultValue={value ?? ''}
      />
    </Field>
  );
}

function ShownCheckbox({
  name,
  label,
  description,
  checked,
}: {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
}) {
  return (
    <>
      <input type="hidden" name={`${name}-shown`} value="true" />
      <Checkbox
        name={name}
        value="true"
        label={label}
        description={description}
        defaultChecked={checked}
      />
    </>
  );
}

function PrivacyNote() {
  return <p className="text-sm text-ink-muted">{PRIVACY_NOTE}</p>;
}

export function Phase7SettingsFields({
  settings,
  environment,
  canPrivacy,
  problem,
}: {
  readonly settings: DashboardSettings;
  readonly environment: EnvironmentKind;
  readonly canPrivacy: boolean;
  readonly problem: DisplayProblem | undefined;
}) {
  const where = ENVIRONMENT_NAMES[environment];
  const collection = settings['signal-collection'];
  const displayName = settings[DISPLAY_NAME_FIELD.name];
  const basis = settings[BIOMETRIC_BASIS_FIELD.name];
  const transactions = settings[TRANSACTION_RETENTION_FIELD.name];
  const graphQueries = settings[GRAPH_QUERY_RETENTION_FIELD.name];
  return (
    <>
      {collection !== undefined && (
        <fieldset className={FIELDSET}>
          <legend className={LEGEND}>Signals in {where}</legend>
          <p className="text-sm text-ink-muted">
            What the flow may collect after consent (C94.6), and whether the API serves the signals.
            The console shows them to every role that reads inquiries either way.
          </p>
          {canPrivacy ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="Session integrity"
                description="Automation and behaviour readings after consent, under the notice.session-integrity text."
                error={fieldErrorOf(problem, '/signal-collection/session-integrity')}
              >
                {(control) => (
                  <select
                    {...control}
                    name="signal-collection.session-integrity"
                    defaultValue={collection['session-integrity']}
                    className={controlClassName(control)}
                  >
                    {SESSION_INTEGRITY_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {SESSION_INTEGRITY_LABELS[mode]}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              <FormField
                label="Device recognition"
                description="Fingerprints that recognise a returning device: off, with the optional consent tick, or exempt on a recorded basis."
                error={fieldErrorOf(problem, '/signal-collection/device-recognition')}
              >
                {(control) => (
                  <select
                    {...control}
                    name="signal-collection.device-recognition"
                    defaultValue={collection['device-recognition']}
                    className={controlClassName(control)}
                  >
                    {DEVICE_RECOGNITION_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {DEVICE_RECOGNITION_LABELS[mode]}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              <FormField
                label="Device recognition basis"
                description="Required for exempt collection: your recorded basis, up to 500 characters."
                error={fieldErrorOf(problem, '/signal-collection/device-recognition-basis')}
                className="sm:col-span-2"
              >
                {(control) => (
                  <textarea
                    {...control}
                    name="signal-collection.device-recognition-basis"
                    rows={2}
                    maxLength={500}
                    defaultValue={collection['device-recognition-basis'] ?? ''}
                    className={controlClassName(control)}
                  />
                )}
              </FormField>
            </div>
          ) : (
            <>
              <dl className="grid gap-4 sm:grid-cols-2">
                <CollectionDetails collection={collection} />
              </dl>
              <PrivacyNote />
            </>
          )}
          {settings['expose-signals'] !== undefined && (
            <ShownCheckbox
              name="expose-signals"
              label="Serve signals on the API and in webhooks"
              description="Off, the API and webhooks serve signals as an empty list; the console still shows them."
              checked={settings['expose-signals']}
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {SIGNAL_WINDOW_FIELDS.map((field) => {
              const value = settings[field.name];
              return value === undefined ? null : (
                <WindowInput key={field.name} field={field} value={value} problem={problem} />
              );
            })}
          </div>
        </fieldset>
      )}
      {displayName !== undefined && (
        <fieldset className={FIELDSET}>
          <legend className={LEGEND}>Device handoff</legend>
          <Field
            label={DISPLAY_NAME_FIELD.label}
            description={DISPLAY_NAME_FIELD.description}
            error={fieldErrorOf(problem, `/${DISPLAY_NAME_FIELD.name}`)}
          >
            <Input
              type="text"
              name={DISPLAY_NAME_FIELD.name}
              maxLength={DISPLAY_NAME_FIELD.max}
              defaultValue={displayName ?? ''}
            />
          </Field>
        </fieldset>
      )}
      {basis !== undefined && (
        <fieldset className={FIELDSET}>
          <legend className={LEGEND}>Lists in {where}</legend>
          {canPrivacy ? (
            <FormField
              label={BIOMETRIC_BASIS_FIELD.label}
              description={BIOMETRIC_BASIS_FIELD.description}
              error={fieldErrorOf(problem, `/${BIOMETRIC_BASIS_FIELD.name}`)}
            >
              {(control) => (
                <textarea
                  {...control}
                  name={BIOMETRIC_BASIS_FIELD.name}
                  rows={3}
                  maxLength={BIOMETRIC_BASIS_FIELD.max}
                  defaultValue={basis ?? ''}
                  className={controlClassName(control)}
                />
              )}
            </FormField>
          ) : (
            <>
              <dl className="grid gap-4">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium text-ink-muted">
                    {BIOMETRIC_BASIS_FIELD.label}
                  </dt>
                  <dd className="text-sm break-words">{basis ?? BIOMETRIC_BASIS_FIELD.unset}</dd>
                </div>
              </dl>
              <PrivacyNote />
            </>
          )}
        </fieldset>
      )}
      {transactions !== undefined && (
        <fieldset className={FIELDSET}>
          <legend className={LEGEND}>Transactions in {where}</legend>
          <WindowInput field={TRANSACTION_RETENTION_FIELD} value={transactions} problem={problem} />
        </fieldset>
      )}
      {settings['graph-indexing'] !== undefined && (
        <fieldset className={FIELDSET}>
          <legend className={LEGEND}>Graph in {where}</legend>
          {canPrivacy ? (
            GRAPH_SWITCHES.map((field) => (
              <ShownCheckbox
                key={field.name}
                name={field.name}
                label={field.label}
                description={field.description}
                checked={settings[field.name] === true}
              />
            ))
          ) : (
            <>
              <dl className="grid gap-4 sm:grid-cols-2">
                <GraphSwitchDetails settings={settings} />
              </dl>
              <PrivacyNote />
            </>
          )}
          {graphQueries !== undefined && (
            <WindowInput
              field={GRAPH_QUERY_RETENTION_FIELD}
              value={graphQueries}
              problem={problem}
            />
          )}
        </fieldset>
      )}
    </>
  );
}
