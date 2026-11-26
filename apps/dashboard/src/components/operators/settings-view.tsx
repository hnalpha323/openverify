import type { DashboardSettings, EnvironmentKind } from '@openverify/contracts';
import { SETTINGS_COPY } from '../../lib/copy/settings';
import { Detail } from '../detail';
import { BudgetTripped } from './budget-tripped';
import { Phase7SettingsView } from './phase7-settings-view';
import { PlatformSettingsView } from './platform-settings-view';
import { WorkflowSettingsView } from './workflow-settings-view';
import {
  ENVIRONMENT_NAMES,
  FACE_FIELDS,
  OTP_FIELD,
  OTP_TRIPPED_TERM,
  REPORT_RETENTION_FIELD,
  RETENTION_FIELDS,
  formatCount,
} from './settings-fields';

const daysOf = (days: number | null) =>
  days === null ? 'Kept until redacted' : `${String(days)} days`;

/** The settings, read-only, for an operator with `settings:read` alone. */
export function SettingsView({
  settings,
  environment,
  canPrivacy,
}: {
  readonly settings: DashboardSettings;
  readonly environment: EnvironmentKind;
  /** C124.3: the private networks of the workflow settings show only with `settings:privacy`. */
  readonly canPrivacy: boolean;
}) {
  const budget = settings[OTP_FIELD.name];
  const reportDays = settings[REPORT_RETENTION_FIELD.name];
  return (
    <div className="flex flex-col gap-8">
      <section
        aria-labelledby="settings-organization"
        className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6"
      >
        <h2 id="settings-organization" className="text-lg font-semibold">
          Organization
        </h2>
        <dl className="grid gap-4">
          <Detail term="Require a second factor">{settings['require-mfa'] ? 'Yes' : 'No'}</Detail>
        </dl>
        {/* C167.2 (SETTING_LEVEL), C168.8, as the form says it. */}
        <p className="text-sm text-ink-muted">{SETTINGS_COPY.platform.organizationLevel}</p>
        {!settings['require-mfa'] && (
          <p className="text-sm font-medium text-ink">{SETTINGS_COPY.platform.noMfa}</p>
        )}
      </section>
      <section
        aria-labelledby="settings-retention"
        className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6"
      >
        <h2 id="settings-retention" className="text-lg font-semibold">
          Retention in {ENVIRONMENT_NAMES[environment]}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          {RETENTION_FIELDS.map((field) => (
            <Detail key={field.name} term={field.term}>
              {daysOf(settings[field.name])}
            </Detail>
          ))}
          <Detail term={REPORT_RETENTION_FIELD.term}>
            {reportDays === undefined ? (
              <span className="text-ink-muted">Not reported</span>
            ) : reportDays === null ? (
              REPORT_RETENTION_FIELD.kept
            ) : (
              `${String(reportDays)} days`
            )}
          </Detail>
        </dl>
      </section>
      <section
        aria-labelledby="settings-face-matching"
        className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6"
      >
        <h2 id="settings-face-matching" className="text-lg font-semibold">
          Face matching in {ENVIRONMENT_NAMES[environment]}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          {FACE_FIELDS.map((field) => {
            const value = settings[field.name];
            return (
              <Detail key={field.name} term={field.term}>
                {value === undefined ? (
                  <span className="text-ink-muted">Not reported</span>
                ) : (
                  `${formatCount(value)} ${field.unit}`
                )}
              </Detail>
            );
          })}
        </dl>
      </section>
      <section
        aria-labelledby="settings-otp"
        className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6"
      >
        <h2 id="settings-otp" className="text-lg font-semibold">
          Text message codes in {ENVIRONMENT_NAMES[environment]}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail term={OTP_FIELD.term}>
            {budget === undefined ? (
              <span className="text-ink-muted">Not reported</span>
            ) : (
              `${formatCount(budget)} ${OTP_FIELD.unit}`
            )}
          </Detail>
          <Detail term={OTP_TRIPPED_TERM}>
            <BudgetTripped at={settings['otp-sms-budget-tripped-at']} />
          </Detail>
        </dl>
      </section>
      <Phase7SettingsView settings={settings} environment={environment} />
      <WorkflowSettingsView settings={settings} environment={environment} canPrivacy={canPrivacy} />
      <PlatformSettingsView settings={settings} environment={environment} />
    </div>
  );
}
