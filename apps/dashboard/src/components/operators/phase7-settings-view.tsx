/**
 * The C107.7 settings read-only (C90.8, C91.7, C97.4, C101, C102.7, C105.5, C108): for an operator
 * with `settings:read` alone, and, inside the form, the privacy members of an operator without
 * `settings:privacy`. A setting the server does not report is left out.
 */
import type { DashboardSettings, EnvironmentKind } from '@openverify/contracts';
import { Detail } from '../detail';
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
  formatCount,
  type WindowField,
} from './settings-fields';

type Collection = NonNullable<DashboardSettings['signal-collection']>;

export const PRIVACY_NOTE = 'Changing these needs the settings:privacy permission.';

const muted = (words: string) => <span className="text-ink-muted">{words}</span>;

/** A window's value in words. */
export function windowText(field: WindowField, value: number | null | undefined) {
  if (value === undefined) {
    return muted('Not reported');
  }
  if (value === null) {
    return field.kept ?? muted('Not set');
  }
  return `${formatCount(value)} days`;
}

/** C90.8: the collection tiers, read-only. */
export function CollectionDetails({ collection }: { readonly collection: Collection }) {
  return (
    <>
      <Detail term="Session integrity">
        {SESSION_INTEGRITY_LABELS[collection['session-integrity']]}
      </Detail>
      <Detail term="Device recognition">
        {DEVICE_RECOGNITION_LABELS[collection['device-recognition']]}
      </Detail>
      <Detail term="Device recognition basis">
        {collection['device-recognition-basis'] ?? muted('None')}
      </Detail>
    </>
  );
}

/** C101: the graph switches, read-only. */
export function GraphSwitchDetails({ settings }: { readonly settings: DashboardSettings }) {
  return (
    <>
      {GRAPH_SWITCHES.map((field) => {
        const value = settings[field.name];
        return (
          <Detail key={field.name} term={field.label}>
            {value === undefined ? muted('Not reported') : value ? 'Yes' : 'No'}
          </Detail>
        );
      })}
    </>
  );
}

function Section({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6"
    >
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Every reported C107.7 setting, read-only. */
export function Phase7SettingsView({
  settings,
  environment,
}: {
  readonly settings: DashboardSettings;
  readonly environment: EnvironmentKind;
}) {
  const where = ENVIRONMENT_NAMES[environment];
  const collection = settings['signal-collection'];
  const displayName = settings[DISPLAY_NAME_FIELD.name];
  const basis = settings[BIOMETRIC_BASIS_FIELD.name];
  return (
    <>
      {collection !== undefined && (
        <Section id="settings-signals" title={`Signals in ${where}`}>
          <dl className="grid gap-4 sm:grid-cols-2">
            <CollectionDetails collection={collection} />
            <Detail term="Serve signals on the API and in webhooks">
              {settings['expose-signals'] === false ? 'No' : 'Yes'}
            </Detail>
            {SIGNAL_WINDOW_FIELDS.map((field) => (
              <Detail key={field.name} term={field.term}>
                {windowText(field, settings[field.name])}
              </Detail>
            ))}
          </dl>
        </Section>
      )}
      {displayName !== undefined && (
        <Section id="settings-handoff" title="Device handoff">
          <dl className="grid gap-4">
            <Detail term={DISPLAY_NAME_FIELD.label}>
              {displayName ?? muted(DISPLAY_NAME_FIELD.unset)}
            </Detail>
          </dl>
        </Section>
      )}
      {basis !== undefined && (
        <Section id="settings-lists" title={`Lists in ${where}`}>
          <dl className="grid gap-4">
            <Detail term={BIOMETRIC_BASIS_FIELD.label}>
              {basis ?? muted(BIOMETRIC_BASIS_FIELD.unset)}
            </Detail>
          </dl>
        </Section>
      )}
      {settings[TRANSACTION_RETENTION_FIELD.name] !== undefined && (
        <Section id="settings-transactions" title={`Transactions in ${where}`}>
          <dl className="grid gap-4">
            <Detail term={TRANSACTION_RETENTION_FIELD.term}>
              {windowText(TRANSACTION_RETENTION_FIELD, settings[TRANSACTION_RETENTION_FIELD.name])}
            </Detail>
          </dl>
        </Section>
      )}
      {settings['graph-indexing'] !== undefined && (
        <Section id="settings-graph" title={`Graph in ${where}`}>
          <dl className="grid gap-4 sm:grid-cols-2">
            <GraphSwitchDetails settings={settings} />
            <Detail term={GRAPH_QUERY_RETENTION_FIELD.term}>
              {windowText(GRAPH_QUERY_RETENTION_FIELD, settings[GRAPH_QUERY_RETENTION_FIELD.name])}
            </Detail>
          </dl>
        </Section>
      )}
    </>
  );
}
