import type { DashboardSettings, EnvironmentKind } from '@openverify/contracts';
import type { ReactNode } from 'react';
import { SETTINGS_COPY } from '../../lib/copy/settings';
import { Detail } from '../detail';
import { ENVIRONMENT_NAMES, formatCount } from './settings-fields';

const COPY = SETTINGS_COPY.platform;
const VIEW = SETTINGS_COPY.platformView;

const SECTION = 'flex flex-col gap-4 rounded-xl border border-line bg-surface p-6';

function Section({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={SECTION}>
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Origins({
  origins,
  none,
}: {
  readonly origins: readonly string[];
  readonly none: string;
}) {
  if (origins.length === 0) {
    return <span className="text-ink-muted">{none}</span>;
  }
  return (
    <ul className="flex flex-col gap-0.5 font-mono">
      {origins.map((origin) => (
        <li key={origin}>{origin}</li>
      ))}
    </ul>
  );
}

function WithHint({ value, hint }: { readonly value: string; readonly hint: string }) {
  return (
    <>
      {value}
      <span className="block text-xs text-ink-muted">{hint}</span>
    </>
  );
}

/**
 * K9-10 (C174.6, DS16): the settings Workflows 9A and 9B added, read-only, for an operator with
 * `settings:read` alone, each shown only where the server reports it, as `PlatformSettingsFields`
 * edits them: the embed and redirect origins with what an allowlist does not stop, the default
 * theme set, the analytics settings, the key age warning, the audit retention and the sender name.
 * An empty or null value says what it means. None of these values is personal data.
 */
export function PlatformSettingsView({
  settings,
  environment,
}: {
  readonly settings: DashboardSettings;
  readonly environment: EnvironmentKind;
}) {
  const name = ENVIRONMENT_NAMES[environment];
  const embed = settings['allowed-embed-origins'];
  const redirect = settings['allowed-redirect-origins'];
  const theme = settings['default-theme-set-id'];
  const zone = settings['analytics-time-zone'];
  const threshold = settings['analytics-suppression-threshold'];
  const retention = settings['analytics-retention-months'];
  const settle = settings['analytics-settle-days'];
  const assignee = settings['analytics-assignee-retention-months'];
  const keyAge = settings['api-key-age-warning-days'];
  const audit = settings['audit-log-retention-days'];
  const sender = settings['mail-sender-name'];
  const keysShown = keyAge !== undefined || audit !== undefined || sender !== undefined;
  return (
    <>
      {embed !== undefined && (
        <Section id="settings-embedding" title={COPY.embedding(name)}>
          <p className="text-sm text-ink-muted">{COPY.allowlistLimits}</p>
          <dl className="grid gap-4">
            <Detail term={VIEW.embedOrigins}>
              <Origins origins={embed} none={VIEW.noEmbedOrigins} />
            </Detail>
            {redirect !== undefined && (
              <Detail term={VIEW.redirectOrigins}>
                {redirect === null ? (
                  VIEW.redirectSameAsEmbed
                ) : (
                  <Origins origins={redirect} none={VIEW.noRedirectOrigins} />
                )}
              </Detail>
            )}
            {theme !== undefined && (
              <Detail term={VIEW.defaultThemeSet}>
                {theme === null ? (
                  <span className="text-ink-muted">{VIEW.noDefaultThemeSet}</span>
                ) : (
                  <span className="font-mono">{theme}</span>
                )}
              </Detail>
            )}
          </dl>
        </Section>
      )}
      {zone !== undefined && (
        <Section id="settings-analytics" title={COPY.analytics(name)}>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail term={VIEW.timeZone}>
              <WithHint value={zone} hint={COPY.timeZoneHint} />
            </Detail>
            {threshold !== undefined && (
              <Detail term={VIEW.threshold}>
                <WithHint value={formatCount(threshold)} hint={COPY.thresholdHint} />
              </Detail>
            )}
            {retention !== undefined && (
              <Detail term={VIEW.retentionMonths}>{VIEW.months(formatCount(retention))}</Detail>
            )}
            {settle !== undefined && (
              <Detail term={VIEW.settleDays}>
                <WithHint value={VIEW.days(formatCount(settle))} hint={COPY.settleHint} />
              </Detail>
            )}
            {assignee !== undefined && (
              <Detail term={VIEW.assigneeMonths}>
                <WithHint value={VIEW.months(formatCount(assignee))} hint={COPY.assigneeHint} />
              </Detail>
            )}
          </dl>
        </Section>
      )}
      {keysShown && (
        <Section id="settings-keys-audit-mail" title={COPY.keysAuditMail(name)}>
          <dl className="grid gap-4 sm:grid-cols-2">
            {keyAge !== undefined && (
              <Detail term={VIEW.keyAge}>
                <WithHint value={VIEW.days(formatCount(keyAge))} hint={COPY.keyAgeHint} />
              </Detail>
            )}
            {audit !== undefined && (
              <Detail term={VIEW.auditRetention}>
                {audit === null ? VIEW.auditKeptForever : VIEW.days(formatCount(audit))}
              </Detail>
            )}
            {sender !== undefined && (
              <Detail term={VIEW.senderName}>
                {sender ?? <span className="text-ink-muted">{VIEW.installationSender}</span>}
              </Detail>
            )}
          </dl>
        </Section>
      )}
    </>
  );
}
