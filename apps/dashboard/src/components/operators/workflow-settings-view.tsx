/**
 * C143.7 (Workflow 8D review R003): the workflow settings read-only, for an operator with
 * `settings:read` alone, so a reader sees what decides what a workflow may do: the run windows, the
 * in-flight cap, the HTTPS ports and hosts, the message recipients, countries and link hosts, and the
 * case retention. The private networks show only with `settings:privacy` (C124.3); without it the
 * view says they are withheld, never that there are none. A setting the server does not report is
 * left out.
 */
import type { DashboardSettings, EnvironmentKind } from '@openverify/contracts';
import { Detail } from '../detail';
import {
  ENVIRONMENT_NAMES,
  WORKFLOW_LIST_FIELDS,
  WORKFLOW_NUMBER_FIELDS,
  WORKFLOW_SETTING_NAMES,
  formatCount,
  type WorkflowListField,
} from './settings-fields';

const muted = (words: string) => <span className="text-ink-muted">{words}</span>;

/** The form's label without its typing hint ("(one per line)"). */
const termOf = (label: string) => label.replace(/ \(one [^)]*per line\)$/, '');

function listText(field: WorkflowListField, value: unknown, canPrivacy: boolean) {
  if (field.privacy && !canPrivacy) {
    return muted('Shown with the settings:privacy permission');
  }
  if (value === null) {
    return field.toggle === null ? muted('None') : field.toggle.off;
  }
  if (!Array.isArray(value) || value.length === 0) {
    return muted('None');
  }
  return value.map((entry) => String(entry)).join(', ');
}

export function WorkflowSettingsView({
  settings,
  environment,
  canPrivacy,
}: {
  readonly settings: DashboardSettings;
  readonly environment: EnvironmentKind;
  readonly canPrivacy: boolean;
}) {
  const served = (name: string) => settings[name as keyof DashboardSettings] !== undefined;
  if (!WORKFLOW_SETTING_NAMES.some(served)) {
    return null;
  }
  return (
    <section
      aria-labelledby="settings-workflows"
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6"
    >
      <h2 id="settings-workflows" className="text-lg font-semibold">
        Workflows in {ENVIRONMENT_NAMES[environment]}
      </h2>
      <dl className="grid gap-4 sm:grid-cols-2">
        {WORKFLOW_NUMBER_FIELDS.filter((field) => served(field.name)).map((field) => {
          const value = settings[field.name];
          return (
            <Detail key={field.name} term={field.label}>
              {typeof value === 'number' ? formatCount(value) : muted(field.kept ?? 'Not set')}
            </Detail>
          );
        })}
        {WORKFLOW_LIST_FIELDS.filter((field) => served(field.name)).map((field) => (
          <Detail key={field.name} term={termOf(field.label)}>
            {listText(field, settings[field.name], canPrivacy)}
          </Detail>
        ))}
      </dl>
    </section>
  );
}
