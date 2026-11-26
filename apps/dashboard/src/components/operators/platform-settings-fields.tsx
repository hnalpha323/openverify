'use client';

import {
  MAIL_SENDER_NAME_MAX_LENGTH,
  type DashboardSettings,
  type EnvironmentKind,
} from '@openverify/contracts';
import { Checkbox, Field, Input } from '@openverify/ui';
import { useState } from 'react';
import type { DisplayProblem } from '../../lib/action-state';
import { SETTINGS_COPY } from '../../lib/copy/settings';
import { FormField, controlClassName } from '../form-field';
import { errorsUnder } from '../integrations/form-errors';
import { ENVIRONMENT_NAMES, PLATFORM_NUMBER_FIELDS } from './settings-fields';

const COPY = SETTINGS_COPY.platform;

/** Every pointer these fields show their own errors at. */
export const PLATFORM_POINTERS: readonly string[] = [
  ...PLATFORM_NUMBER_FIELDS.map((field) => `/${field.name}`),
  '/analytics-time-zone',
  '/mail-sender-name',
];

/** The entries of the origin fields' errors, which name each refused position. */
export function platformListPointers(problem: DisplayProblem | undefined): string[] {
  return (
    (problem?.errors ?? [])
      .map((error) => error.pointer)
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      .filter((pointer) => /^\/allowed-(?:embed|redirect)-origins(?:\/\d+)?$/u.test(pointer))
  );
}

export interface PlatformSettingsFieldsProps {
  readonly settings: DashboardSettings;
  readonly environment: EnvironmentKind;
  readonly problem: DisplayProblem | undefined;
  /** The IANA zones the server knows, for the reporting zone's choices. */
  readonly timeZones?: readonly string[];
}

function NumberField({
  field,
  settings,
  problem,
}: {
  readonly field: (typeof PLATFORM_NUMBER_FIELDS)[number];
  readonly settings: DashboardSettings;
  readonly problem: DisplayProblem | undefined;
}) {
  const value = settings[field.name];
  return (
    <Field
      label={field.label}
      {...(field.hint === undefined ? {} : { description: field.hint })}
      error={errorsUnder(problem, `/${field.name}`)}
    >
      <Input
        type="number"
        name={field.name}
        inputMode="numeric"
        min={field.bounds.min}
        max={field.bounds.max}
        step={1}
        defaultValue={value ?? ''}
      />
    </Field>
  );
}

const FIELDSET = 'flex flex-col gap-4 rounded-xl border border-line bg-surface p-6';
const LEGEND = 'px-1 text-lg font-semibold text-ink';

/**
 * C174.6: the settings Workflows 9A and 9B added, each shown only where the server reports it:
 * the embed and redirect origins (C158.1, C158.4) with what an allowlist does not stop (C157.4,
 * C158.7) and, in production, the wildcard acknowledgement; the analytics settings (C163, C164.7);
 * the key age warning (C169.2), the audit retention (C168.6) and the sender name (C169.8).
 */
export function PlatformSettingsFields({
  settings,
  environment,
  problem,
  timeZones = [],
}: PlatformSettingsFieldsProps) {
  const embed = settings['allowed-embed-origins'];
  const redirect = settings['allowed-redirect-origins'];
  const [ownRedirects, setOwnRedirects] = useState(redirect !== null && redirect !== undefined);
  const name = ENVIRONMENT_NAMES[environment];
  const zone = settings['analytics-time-zone'];
  const zones = zone === undefined || timeZones.includes(zone) ? timeZones : [zone, ...timeZones];
  const numbers = (group: 'analytics' | 'keys') =>
    PLATFORM_NUMBER_FIELDS.filter(
      (field) => field.group === group && settings[field.name] !== undefined,
    );
  return (
    <>
      {embed !== undefined && (
        <fieldset className={FIELDSET}>
          <legend className={LEGEND}>{COPY.embedding(name)}</legend>
          <p className="text-sm text-ink-muted">{COPY.allowlistLimits}</p>
          <FormField
            label={COPY.embedOrigins}
            description={COPY.embedOriginsHint}
            error={errorsUnder(problem, '/allowed-embed-origins')}
          >
            {(control) => (
              <textarea
                {...control}
                name="allowed-embed-origins"
                rows={4}
                defaultValue={embed.join('\n')}
                spellCheck={false}
                className={`${controlClassName(control)} font-mono text-sm`}
              />
            )}
          </FormField>
          <input type="hidden" name="allowed-redirect-origins-shown" value="true" />
          <Checkbox
            name="allowed-redirect-origins-own"
            value="true"
            label={COPY.redirectOwn}
            description={COPY.redirectOwnHint}
            checked={ownRedirects}
            onChange={(event) => {
              setOwnRedirects(event.currentTarget.checked);
            }}
          />
          {ownRedirects && (
            <FormField
              label={COPY.redirectOrigins}
              description={COPY.redirectOriginsHint}
              error={errorsUnder(problem, '/allowed-redirect-origins')}
            >
              {(control) => (
                <textarea
                  {...control}
                  name="allowed-redirect-origins"
                  rows={3}
                  defaultValue={(redirect ?? []).join('\n')}
                  spellCheck={false}
                  className={`${controlClassName(control)} font-mono text-sm`}
                />
              )}
            </FormField>
          )}
          {environment === 'production' && (
            <Checkbox
              name="acknowledge-wildcards"
              value="true"
              label={COPY.acknowledgeWildcards}
              description={COPY.acknowledgeHint}
            />
          )}
        </fieldset>
      )}
      {zone !== undefined && (
        <fieldset className={FIELDSET}>
          <legend className={LEGEND}>{COPY.analytics(name)}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={COPY.timeZone}
              description={COPY.timeZoneHint}
              error={errorsUnder(problem, '/analytics-time-zone')}
            >
              {(control) => (
                <select
                  {...control}
                  name="analytics-time-zone"
                  defaultValue={zone}
                  className={controlClassName(control)}
                >
                  {(zones.length === 0 ? [zone] : zones).map((each) => (
                    <option key={each} value={each}>
                      {each}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            {numbers('analytics').map((field) => (
              <NumberField key={field.name} field={field} settings={settings} problem={problem} />
            ))}
          </div>
        </fieldset>
      )}
      {numbers('keys').length > 0 && (
        <fieldset className={FIELDSET}>
          <legend className={LEGEND}>{COPY.keysAuditMail(name)}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {numbers('keys').map((field) => (
              <NumberField key={field.name} field={field} settings={settings} problem={problem} />
            ))}
            {settings['mail-sender-name'] !== undefined && (
              <Field
                label={COPY.senderName}
                description={COPY.senderNameHint}
                error={errorsUnder(problem, '/mail-sender-name')}
              >
                <Input
                  name="mail-sender-name"
                  maxLength={MAIL_SENDER_NAME_MAX_LENGTH}
                  defaultValue={settings['mail-sender-name'] ?? ''}
                  autoComplete="off"
                />
              </Field>
            )}
          </div>
        </fieldset>
      )}
    </>
  );
}
