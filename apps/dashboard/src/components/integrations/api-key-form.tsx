'use client';

import { Alert, Button, Checkbox, Field, Input } from '@openverify/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { EnvironmentField } from '../environment-field';
import { FormField, controlClassName } from '../form-field';
import { LINK_CLASS } from '../link-styles';
import { OneTimeSecretDialog } from '../one-time-secret-dialog';
import { ProblemDisplay } from '../problem-display';
import { formatUtc } from '../timestamp';
import { useFormAction } from '../use-form-action';
import type { CreatedApiKey } from './action-data';
import { CUSTOM_EXPIRY, EXPIRY_CHOICES } from './expiry-choices';
import { errorsUnder } from './form-errors';

export interface CreateApiKeyFormProps {
  readonly action: (
    state: ActionState<CreatedApiKey>,
    formData: FormData,
  ) => Promise<ActionResult<CreatedApiKey>>;
  /** The API scopes the operator's role holds: the only ones a key it creates may hold (C12). */
  readonly scopes: readonly string[];
  /** Every supported API version, oldest first; a new key gets the latest. */
  readonly apiVersions: readonly string[];
  /**
   * Whether the operator lacks `pii:view`: a key it creates then sees personal data masked too
   * (Workflow 2B F001), which the form says before the key is made.
   */
  readonly piiMasked: boolean;
  /** The session environment the page was rendered for (Workflow 2D F002). */
  readonly environmentId: string;
}

const ATTRIBUTES = '/data/attributes';

/**
 * Creates an API key: its name, scopes (only those the operator holds), allowed IP ranges, API
 * version and expiry (one of the offered times, or a date and time in UTC), in one call (C25.5).
 * The token is shown once in the one-time secret dialog (C21), with when the key expires;
 * closing it opens the key's page.
 */
export function CreateApiKeyForm({
  action,
  scopes,
  apiVersions,
  piiMasked,
  environmentId,
}: CreateApiKeyFormProps) {
  const id = useId();
  const router = useRouter();
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const submit = useFormAction(action, { onSuccess: setCreated });
  // Controlled, so the date and time field shows only for its choice.
  const [expiry, setExpiry] = useState('');
  const error = (pointer: string) => errorsUnder(submit.problem, pointer);
  const scopesDescriptionId = `${id}-scopes-description`;
  const scopesErrorId = `${id}-scopes-error`;
  const scopesError = error(`${ATTRIBUTES}/scopes`);

  return (
    <>
      <form {...submit.formProps} noValidate className="flex flex-col gap-6">
        <EnvironmentField environmentId={environmentId} />
        {piiMasked && (
          <Alert tone="info" title="This key will not see personal data">
            Your role cannot see personal data, so neither can a key you create: it reads field
            values, notes, IP addresses and user agents as empty, and cannot download files.
          </Alert>
        )}
        <Field label="Name" error={error(`${ATTRIBUTES}/name`)} required>
          <Input name="name" autoComplete="off" maxLength={200} />
        </Field>
        <fieldset
          aria-describedby={[
            scopesDescriptionId,
            scopesError === undefined ? undefined : scopesErrorId,
          ]
            .filter(Boolean)
            .join(' ')}
          className="flex flex-col gap-3"
        >
          <legend className="mb-1 text-sm font-medium text-ink">Scopes</legend>
          <p id={scopesDescriptionId} className="text-sm text-ink-muted">
            What the key may do. A key can hold only the permissions your role holds.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {scopes.map((scope) => (
              <Checkbox
                key={scope}
                name="scopes"
                value={scope}
                label={<code className="font-mono text-xs">{scope}</code>}
              />
            ))}
          </div>
          {scopesError !== undefined && (
            <p id={scopesErrorId} className="text-sm font-medium text-danger">
              {scopesError}
            </p>
          )}
        </fieldset>
        <FormField
          label="Allowed IP ranges"
          description="CIDR ranges the key may be used from, one per line, such as 203.0.113.0/24. Leave empty to allow every address."
          error={error(`${ATTRIBUTES}/allowed-ips`)}
        >
          {(control) => (
            <textarea
              {...control}
              name="allowed-ips"
              rows={3}
              spellCheck={false}
              className={`${controlClassName(control)} font-mono text-sm`}
            />
          )}
        </FormField>
        <div className="grid gap-6 sm:grid-cols-2">
          <FormField
            label="API version"
            description="Used when a request names no OpenVerify-Version."
            error={error(`${ATTRIBUTES}/api-version`)}
          >
            {(control) => (
              <select
                {...control}
                name="api-version"
                defaultValue={apiVersions.at(-1)}
                className={controlClassName(control)}
              >
                {apiVersions.map((version) => (
                  <option key={version} value={version}>
                    {version}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField
            label="Expires"
            description="After it expires, every request with its token is refused."
            error={error('/expires-in-seconds')}
          >
            {(control) => (
              <select
                {...control}
                name="expires-in-seconds"
                value={expiry}
                onChange={(event) => {
                  setExpiry(event.currentTarget.value);
                }}
                className={controlClassName(control)}
              >
                <option value="">Never</option>
                {EXPIRY_CHOICES.map((choice) => (
                  <option key={choice.seconds} value={String(choice.seconds)}>
                    {choice.label}
                  </option>
                ))}
                <option value={CUSTOM_EXPIRY}>At a date and time (UTC)</option>
              </select>
            )}
          </FormField>
          {expiry === CUSTOM_EXPIRY && (
            <FormField
              label="Expires at (UTC)"
              description="Within the next 30 days. The key stops working at that second."
              error={error('/expires-at')}
            >
              {(control) => (
                <input
                  {...control}
                  type="datetime-local"
                  name="expires-at"
                  step={1}
                  className={controlClassName(control)}
                />
              )}
            </FormField>
          )}
        </div>
        <ProblemDisplay problem={submit.problem} />
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={submit.pending}>
            {submit.pending ? 'Creating…' : 'Create API key'}
          </Button>
          <Link href="/api-keys" className={LINK_CLASS}>
            Cancel
          </Link>
        </div>
      </form>
      {created !== null && (
        <OneTimeSecretDialog
          open
          title="API key created"
          label="Token"
          secret={created.secret}
          description="Send it as a bearer token: Authorization: Bearer followed by the token. This is the only time it is shown: copy it now and keep it somewhere safe."
          onClose={() => {
            const { id: keyId } = created;
            setCreated(null);
            router.push(`/api-keys/${keyId}`);
          }}
        >
          {piiMasked && (
            <p className="text-sm text-ink-muted">Like you, this key cannot see personal data.</p>
          )}
          {typeof created.expiresAt === 'string' && (
            <p className="text-sm text-ink-muted">{`It expires on ${formatUtc(created.expiresAt)} UTC.`}</p>
          )}
        </OneTimeSecretDialog>
      )}
    </>
  );
}
