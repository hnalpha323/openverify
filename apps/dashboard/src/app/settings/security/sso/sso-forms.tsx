'use client';

/**
 * C248.3, C248.5, C248.6, C248.8 (Phase 11, Workflow 11B, `sso-oidc`): the forms of Settings →
 * Security → Single sign-on. The client secret field is always empty: the API never serves the
 * secret, only whether one is set, and an empty field keeps it on a change.
 */
import { SSO_TENANT_PIN_CLAIMS } from '@openverify/contracts';
import { Button, Checkbox, Field, Input } from '@openverify/ui';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../../../lib/action-state';
import { EnvironmentField } from '../../../../components/environment-field';
import { FormField, controlClassName } from '../../../../components/form-field';
import { ProblemDisplay } from '../../../../components/problem-display';
import { useToast } from '../../../../components/toasts';
import { useFormAction } from '../../../../components/use-form-action';
import { SSO_PROVIDER_FIELDS as F } from './sso-form-input';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

/** A provider as the forms show it: never its secret. */
export interface SsoProviderView {
  readonly id: string;
  readonly displayName: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly secretSet: boolean;
  readonly domains: readonly string[];
  readonly tenantPin: { readonly claim: string; readonly value: string } | null;
  readonly amr: readonly string[];
  readonly acr: readonly string[];
  readonly jit: boolean;
  readonly roleIds: readonly string[];
  readonly enforced: boolean;
}

export interface RoleChoice {
  readonly id: string;
  readonly name: string;
}

const at = (name: string) => `/data/attributes/${name}`;

const PIN_WORDS: Readonly<Record<string, string>> = {
  tid: 'Tenant id (tid)',
  hd: 'Hosted domain (hd)',
};

function StepUpField({ error }: { readonly error: string | undefined }) {
  return (
    <Field
      label="Code from your authenticator app"
      description="Changing single sign-on needs a second factor checked in the last 10 minutes. Leave empty if you confirmed recently."
      error={error}
    >
      <Input name={F.stepUpCode} inputMode="numeric" autoComplete="one-time-code" maxLength={10} />
    </Field>
  );
}

export interface SsoProviderFormProps {
  readonly provider?: SsoProviderView | undefined;
  readonly roles: readonly RoleChoice[];
  readonly environmentId: string;
  readonly action: Action;
}

/** Adds a provider, or changes one (`provider` set). */
export function SsoProviderForm({ provider, roles, environmentId, action }: SsoProviderFormProps) {
  const { show } = useToast();
  const editing = provider !== undefined;
  const { pending, problem, formProps } = useFormAction(action, {
    resetOnSuccess: !editing,
    onSuccess: () => {
      show({
        tone: 'success',
        message: editing ? 'Identity provider saved.' : 'Identity provider added.',
      });
    },
  });
  const error = (name: string) => fieldErrorOf(problem, at(name));
  return (
    <form {...formProps} className="flex flex-col gap-4" noValidate>
      <EnvironmentField environmentId={environmentId} />
      {editing && <input type="hidden" name={F.providerId} value={provider.id} />}
      <Field label="Name on the sign-in page" error={error(F.displayName)}>
        <Input name={F.displayName} defaultValue={provider?.displayName} maxLength={100} required />
      </Field>
      <Field
        label="Issuer"
        description="The exact issuer of the provider’s ID tokens (its discovery document is read from it)."
        error={error(F.issuer)}
      >
        <Input
          name={F.issuer}
          type="url"
          defaultValue={provider?.issuer}
          spellCheck={false}
          required
        />
      </Field>
      <Field label="Client id" error={error(F.clientId)}>
        <Input name={F.clientId} defaultValue={provider?.clientId} spellCheck={false} required />
      </Field>
      <Field
        label="Client secret"
        description={
          editing
            ? provider.secretSet
              ? 'A secret is set and is never shown. Leave empty to keep it.'
              : 'No secret is set.'
            : 'Kept encrypted and never shown again.'
        }
        error={error(F.clientSecret)}
      >
        <Input name={F.clientSecret} type="password" autoComplete="off" required={!editing} />
      </Field>
      <Field
        label="Allowed email domains"
        description="One or more, separated by commas or spaces, such as example.com. A first sign-in links or creates a user only for a verified email in one of them."
        error={error(F.domains)}
      >
        <Input
          name={F.domains}
          defaultValue={provider?.domains.join(', ')}
          spellCheck={false}
          required
        />
      </Field>
      <FormField
        label="Tenant pin"
        description="Required for an issuer many tenants share; every ID token must carry this value."
        error={error('tenant-pin')}
      >
        {(control) => (
          <select
            {...control}
            name={F.pinClaim}
            defaultValue={provider?.tenantPin?.claim ?? ''}
            className={controlClassName(control)}
          >
            <option value="">No pin</option>
            {SSO_TENANT_PIN_CLAIMS.map((claim) => (
              <option key={claim} value={claim}>
                {PIN_WORDS[claim]}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <Field label="Tenant pin value" error={error(F.pinValue)}>
        <Input name={F.pinValue} defaultValue={provider?.tenantPin?.value} spellCheck={false} />
      </Field>
      <Field
        label="Required authentication methods (amr)"
        description="Separated by spaces. When the ID token shows every one, the sign-in stands in for the local second factor; otherwise an organization that requires MFA asks for it."
        error={error(F.amr)}
      >
        <Input name={F.amr} defaultValue={provider?.amr.join(' ')} spellCheck={false} />
      </Field>
      <Field
        label="Accepted authentication contexts (acr)"
        description="Separated by spaces; the ID token’s acr must be one of them."
        error={error(F.acr)}
      >
        <Input name={F.acr} defaultValue={provider?.acr.join(' ')} spellCheck={false} />
      </Field>
      <Checkbox
        name={F.jit}
        label="Create users on their first sign-in"
        description="Off by default. A new user gets the roles below, which may hold no organization-wide permission, no settings change, no API keys, no Connect activation or attestation, no access export and no production access."
        defaultChecked={provider?.jit ?? false}
      />
      {roles.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Roles for users created on first sign-in</legend>
          {roles.map((role) => (
            <Checkbox
              key={role.id}
              name={F.roles}
              value={role.id}
              label={role.name}
              defaultChecked={provider?.roleIds.includes(role.id) ?? false}
            />
          ))}
          {fieldErrorOf(problem, at(F.roles)) !== undefined && (
            <p className="text-sm text-danger">{fieldErrorOf(problem, at(F.roles))}</p>
          )}
        </fieldset>
      )}
      <Checkbox
        name={F.enforced}
        label="Single sign-on only"
        description="Password sign-in is refused for this organization’s users, except one sign-in an operator allows with user:allow-password."
        defaultChecked={provider?.enforced ?? false}
      />
      <StepUpField error={fieldErrorOf(problem, `/${F.stepUpCode}`)} />
      <ProblemDisplay problem={problem} />
      <div>
        <Button type="submit" disabled={pending}>
          {editing ? 'Save identity provider' : 'Add identity provider'}
        </Button>
      </div>
    </form>
  );
}

export interface DeleteSsoProviderFormProps {
  readonly provider: Pick<SsoProviderView, 'id' | 'displayName'>;
  readonly environmentId: string;
  readonly action: Action;
}

/** Removes a provider; its linked identities go with it. */
export function DeleteSsoProviderForm({
  provider,
  environmentId,
  action,
}: DeleteSsoProviderFormProps) {
  const { show } = useToast();
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'Identity provider removed.' });
    },
  });
  return (
    <form {...formProps} className="flex flex-col gap-3" noValidate>
      <EnvironmentField environmentId={environmentId} />
      <input type="hidden" name={F.providerId} value={provider.id} />
      <StepUpField error={fieldErrorOf(problem, `/${F.stepUpCode}`)} />
      <ProblemDisplay problem={problem} />
      <div>
        <Button type="submit" variant="danger" disabled={pending}>
          Remove {provider.displayName}
        </Button>
      </div>
    </form>
  );
}

export interface SignInNameFormProps {
  readonly slug: string | null;
  readonly environmentId: string;
  readonly action: Action;
}

/** C248.8: the organization's sign-in name, which single sign-on starts from. */
export function SignInNameForm({ slug, environmentId, action }: SignInNameFormProps) {
  const { show } = useToast();
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'Sign-in name saved.' });
    },
  });
  return (
    <form {...formProps} className="flex flex-col gap-4" noValidate>
      <EnvironmentField environmentId={environmentId} />
      <Field
        label="Sign-in name"
        description="Users type it on the sign-in page to start single sign-on: 3 to 63 lower-case letters, digits and inner hyphens. Leave empty to remove it."
        error={fieldErrorOf(problem, '/organization-slug')}
      >
        <Input
          name="organization-slug"
          defaultValue={slug ?? ''}
          autoCapitalize="none"
          spellCheck={false}
          maxLength={63}
        />
      </Field>
      <ProblemDisplay problem={problem} />
      <div>
        <Button type="submit" disabled={pending}>
          Save sign-in name
        </Button>
      </div>
    </form>
  );
}
