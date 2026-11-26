import { Alert, Card, type AlertTone } from '@openverify/ui';
import type { Metadata } from 'next';
import { LoginForm } from '../../components/login-form';
import { NO_ENVIRONMENT_ROLE_WORDS } from '../../lib/login-state';
import { SsoSignIn, ssoChoicesFor, ssoNoticeOf } from '../(auth)/sso/sso-sign-in';
import { login } from '../actions/auth';

export const metadata: Metadata = { title: 'Sign in' };

/** Why the operator was sent back here (`/login?reason=...`); unknown reasons show nothing. */
const NOTICES: Readonly<Record<string, { readonly tone: AlertTone; readonly text: string }>> = {
  'mfa-attempts': { tone: 'warning', text: 'Too many wrong codes. Sign in again.' },
  'mfa-expired': { tone: 'info', text: 'The sign-in took too long. Sign in again.' },
  // C25.1 mfa_token_invalid: the token expired, was used, or was revoked elsewhere.
  'mfa-invalid': { tone: 'info', text: 'That sign-in is no longer valid. Sign in again.' },
  'mfa-reauth': { tone: 'info', text: 'Sign in again with your second factor.' },
  // C245.2 (Workflow 11B): the API ended the session; `/login/signed-out` cleared the cookie.
  'session-idle': { tone: 'info', text: 'You were signed out after inactivity. Sign in again.' },
  'session-absolute': {
    tone: 'info',
    text: 'Your session reached its time limit. Sign in again.',
  },
  // C167.2: both factors passed, but the account holds no role in any environment.
  'no-environment-role': { tone: 'warning', text: NO_ENVIRONMENT_ROLE_WORDS.signIn },
  'signout-incomplete': {
    tone: 'warning',
    text: 'You are signed out in this browser, but OpenVerify could not end the session on the server. It stops working when it expires. To end it now, sign in and sign out again.',
  },
  'invitation-accepted': {
    tone: 'success',
    text: 'Your account is ready. Sign in with your email and new password.',
  },
};

export interface LoginPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { reason, sso } = await searchParams;
  const notice =
    (typeof reason === 'string' && Object.hasOwn(NOTICES, reason) ? NOTICES[reason] : undefined) ??
    // C248.4 (Workflow 11B `sso-oidc`, a named borrowed edit): single sign-on's generic sentences,
    // and the providers to choose from when an organisation has several.
    ssoNoticeOf(reason);
  const choosing = await ssoChoicesFor(sso);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <Card title="Sign in to OpenVerify" headingLevel={1} className="w-full max-w-sm">
        <div className="flex flex-col gap-5">
          {notice !== undefined && <Alert tone={notice.tone}>{notice.text}</Alert>}
          <LoginForm action={login} />
          <SsoSignIn choosing={choosing} />
        </div>
      </Card>
    </main>
  );
}
