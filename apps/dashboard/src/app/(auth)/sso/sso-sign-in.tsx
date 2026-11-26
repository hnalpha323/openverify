/**
 * C248.4, C248.8 (Phase 11, Workflow 11B, `sso-oidc`): the sign-in page's single sign-on section. A
 * plain GET form takes the organisation's sign-in name (`/sso/start`); an organisation with several
 * providers comes back here (`/login?sso=<name>`) and chooses one. Every provider link is a plain
 * anchor, never a prefetching `Link`, because opening the start creates a sign-in attempt.
 */
import { organizationSlugSchema } from '@openverify/contracts';
import { Button, Field, Input, type AlertTone } from '@openverify/ui';
import { headers } from 'next/headers';
import { LINK_CLASS } from '../../../components/link-styles';
import { SSO_FAILURE_WORDS, ssoFailureReason, startSso, type SsoFailure } from './sso-bff';

/** One provider to choose. */
export interface SsoChoice {
  readonly id: string;
  readonly displayName: string;
}

/** An organisation whose providers the sign-in page offers. */
export interface SsoChoosing {
  readonly organization: string;
  readonly choices: readonly SsoChoice[];
}

/** The providers of `/login?sso=<name>`, or `null` when there is nothing to choose. */
export async function ssoChoicesFor(
  organization: string | string[] | undefined,
): Promise<SsoChoosing | null> {
  const parsed = organizationSlugSchema.safeParse(organization);
  if (!parsed.success) {
    return null;
  }
  const outcome = await startSso(parsed.data, {}, (await headers()).get('user-agent'));
  return outcome.kind === 'choose'
    ? { organization: parsed.data, choices: outcome.providers }
    : null;
}

/** `/login?reason=...` for each SSO failure (C167.2's own reason is the sign-in page's). */
const SSO_NOTICES: ReadonlyMap<string, string> = new Map(
  (Object.entries(SSO_FAILURE_WORDS) as [SsoFailure, string][])
    .filter(([failure]) => failure !== 'no_environment_role')
    .map(([failure, words]) => [ssoFailureReason(failure), words]),
);

/** The notice of `/login?reason=sso-...`, or `undefined` for any other reason. */
export function ssoNoticeOf(
  reason: string | string[] | undefined,
): { readonly tone: AlertTone; readonly text: string } | undefined {
  const text = typeof reason === 'string' ? SSO_NOTICES.get(reason) : undefined;
  return text === undefined ? undefined : { tone: 'warning', text };
}

export interface SsoSignInProps {
  readonly choosing: SsoChoosing | null;
}

/** The section under the password form. */
export function SsoSignIn({ choosing }: SsoSignInProps) {
  return (
    <section
      aria-labelledby="sso-sign-in-heading"
      className="flex flex-col gap-3 border-t border-line pt-5"
    >
      <h2 id="sso-sign-in-heading" className="text-sm font-semibold">
        Single sign-on
      </h2>
      {choosing === null ? (
        <form method="get" action="/sso/start" className="flex flex-col gap-3">
          <Field
            label="Sign-in name"
            description="Your organization’s sign-in name, from its administrator."
          >
            <Input
              name="organization"
              autoComplete="organization"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={63}
              required
            />
          </Field>
          <Button type="submit" variant="secondary">
            Continue with single sign-on
          </Button>
        </form>
      ) : (
        <ul className="flex flex-col gap-2">
          {choosing.choices.map((choice) => (
            <li key={choice.id}>
              {/* A plain anchor: the start creates an attempt, so it is never prefetched. */}
              <a
                href={`/sso/${choosing.organization}/start?provider-id=${choice.id}`}
                className={LINK_CLASS}
              >
                Sign in with {choice.displayName}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
