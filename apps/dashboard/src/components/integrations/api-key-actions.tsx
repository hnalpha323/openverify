'use client';

import { Field, Input } from '@openverify/ui';
import { useRouter } from 'next/navigation';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { SETTINGS_COPY } from '../../lib/copy/settings';
import { FormField, controlClassName } from '../form-field';
import { formatUtc } from '../timestamp';
import type { CreatedApiKey, RotatedApiKeyData } from './action-data';
import { EXPIRE_NOW, EXPIRY_CHOICES, ROTATION_CHOICES } from './expiry-choices';
import { errorsUnder } from './form-errors';
import { FormDialogButton } from './form-dialog-button';
import { SecretActionButton } from './secret-action-button';

const KEYS = SETTINGS_COPY.keys;

type Action<Data = undefined> = (
  state: ActionState<Data>,
  formData: FormData,
) => Promise<ActionResult<Data>>;

export interface ApiKeyActionsProps {
  readonly apiKeyId: string;
  readonly name: string;
  readonly allowedIps: readonly string[];
  /** An expired key is not offered a new expiry, which would bring it back. */
  readonly expired: boolean;
  /** Whether the operator lacks `pii:view`: a copy it makes is masked too (Workflow 2B F001). */
  readonly piiMasked: boolean;
  /** The key sees personal data masked (C25.6), so a copy does too. */
  readonly maskedKey?: boolean;
  readonly update: Action;
  readonly expire: Action;
  readonly clone: Action<CreatedApiKey>;
  /** C169.1: a new key with a new token, the old one working until the time chosen. */
  readonly rotate: Action<RotatedApiKeyData>;
  /** C169.1: the key's note; `null` or absent when none. */
  readonly note?: string | null;
  /** C169.3: the attributes this key never receives. */
  readonly attributeBlocklist?: readonly string[];
}

/**
 * The changes an operator with `api-keys:write` can make to a key (C12): rename it and change
 * its allowed IP ranges, clone it (the clone's token is shown once), expire it.
 */
export function ApiKeyActions({
  apiKeyId,
  name,
  allowedIps,
  expired,
  piiMasked,
  maskedKey = false,
  update,
  expire,
  clone,
  rotate,
  note = null,
  attributeBlocklist = [],
}: ApiKeyActionsProps) {
  const router = useRouter();
  const fields = { 'api-key-id': apiKeyId };

  return (
    <div className="flex flex-wrap items-start gap-3">
      <FormDialogButton
        label="Edit"
        title="Edit the API key"
        submitLabel="Save changes"
        pendingLabel="Saving…"
        action={update}
        fields={fields}
        successMessage="The API key was saved."
      >
        {(problem) => (
          <>
            <Field label="Name" error={errorsUnder(problem, '/data/attributes/name')} required>
              <Input name="name" defaultValue={name} autoComplete="off" maxLength={200} />
            </Field>
            <FormField
              label="Allowed IP ranges"
              description="CIDR ranges, one per line. Leave empty to allow every address."
              error={errorsUnder(problem, '/data/attributes/allowed-ips')}
            >
              {(control) => (
                <textarea
                  {...control}
                  name="allowed-ips"
                  rows={3}
                  defaultValue={allowedIps.join('\n')}
                  spellCheck={false}
                  className={`${controlClassName(control)} font-mono text-sm`}
                />
              )}
            </FormField>
            <FormField
              label={KEYS.note}
              description={KEYS.noteDescription}
              error={errorsUnder(problem, '/data/attributes/note')}
            >
              {(control) => (
                <textarea
                  {...control}
                  name="note"
                  rows={2}
                  maxLength={255}
                  defaultValue={note ?? ''}
                  className={controlClassName(control)}
                />
              )}
            </FormField>
            <FormField
              label={KEYS.blocklist}
              description={KEYS.blocklistDescription}
              error={errorsUnder(problem, '/data/attributes/attribute-blocklist')}
            >
              {(control) => (
                <textarea
                  {...control}
                  name="attribute-blocklist"
                  rows={3}
                  defaultValue={attributeBlocklist.join('\n')}
                  spellCheck={false}
                  className={`${controlClassName(control)} font-mono text-sm`}
                />
              )}
            </FormField>
          </>
        )}
      </FormDialogButton>
      {!expired && (
        <SecretActionButton<RotatedApiKeyData>
          label={KEYS.rotate}
          title={KEYS.rotateTitle}
          description={KEYS.rotateDescription}
          confirmLabel={KEYS.rotateConfirm}
          pendingLabel={KEYS.rotating}
          action={rotate}
          fields={fields}
          secretTitle={KEYS.rotatedTitle}
          secretLabel={KEYS.rotatedLabel}
          secretDescription={(data) => KEYS.rotatedUntil(formatUtc(data.previousExpiresAt))}
          onClosed={(data) => {
            router.push(`/api-keys/${data.id}`);
          }}
        >
          <FormField label={KEYS.previousLabel}>
            {(control) => (
              <select
                {...control}
                name="previous-expires-in-seconds"
                defaultValue="86400"
                className={controlClassName(control)}
              >
                {ROTATION_CHOICES.map((seconds) => (
                  <option key={seconds} value={String(seconds)}>
                    {KEYS.previousChoices[seconds as keyof typeof KEYS.previousChoices]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <Field label={KEYS.newName} description={KEYS.newNameDescription}>
            <Input name="name" autoComplete="off" maxLength={200} />
          </Field>
        </SecretActionButton>
      )}
      <SecretActionButton
        label="Clone"
        title="Clone this API key?"
        description={
          piiMasked
            ? 'The copy has the same scopes, allowed IP ranges and API version, and a new token. Your role cannot see personal data, so the copy cannot either.'
            : maskedKey
              ? 'The copy has the same scopes, allowed IP ranges and API version, and a new token. Like this key, the copy cannot see personal data.'
              : 'The copy has the same scopes, allowed IP ranges and API version, and a new token.'
        }
        confirmLabel="Clone key"
        pendingLabel="Cloning…"
        action={clone}
        fields={fields}
        secretTitle="API key cloned"
        secretLabel="Token"
        onClosed={(data) => {
          router.push(`/api-keys/${data.id}`);
        }}
      >
        <Field label="Name of the copy" description="Leave empty to let the API name it.">
          <Input name="name" autoComplete="off" maxLength={200} />
        </Field>
      </SecretActionButton>
      {!expired && (
        <FormDialogButton
          label="Expire"
          variant="danger"
          tone="danger"
          title="Expire this API key?"
          description="From then on, every request with its token is refused."
          submitLabel="Expire key"
          pendingLabel="Expiring…"
          action={expire}
          fields={fields}
          successMessage="The API key expiry is set."
        >
          {(problem) => (
            <FormField label="When" error={errorsUnder(problem, '/expires-in-seconds')}>
              {(control) => (
                <select
                  {...control}
                  name="expires-in-seconds"
                  defaultValue={String(EXPIRE_NOW.seconds)}
                  className={controlClassName(control)}
                >
                  {[EXPIRE_NOW, ...EXPIRY_CHOICES].map((choice) => (
                    <option key={choice.seconds} value={String(choice.seconds)}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          )}
        </FormDialogButton>
      )}
    </div>
  );
}
