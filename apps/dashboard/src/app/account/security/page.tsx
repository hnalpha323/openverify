import { Alert, Button } from '@openverify/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { MfaFactorTable } from '../../../components/mfa-factor-table';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { RecoveryCodesButton } from '../../../components/recovery-codes-button';
import { TotpEnrolment } from '../../../components/totp-enrolment';
import { WebauthnEnrolment } from '../../../components/webauthn-enrolment';
import { listMfaFactors } from '../../../lib/api/mfa';
import { renderPage } from '../../../lib/api/page';
import { SETTINGS_COPY } from '../../../lib/copy/settings';
import { LINK_CLASS } from '../../../components/link-styles';
import { toFactorSummary } from '../../../lib/mfa-enrolment';
import {
  confirmTotpEnrolment,
  finishWebauthnEnrolment,
  regenerateCodes,
  removeMfaFactor,
  signInAgain,
  startTotpEnrolment,
  startWebauthnEnrolment,
} from '../../actions/account-security';

export const metadata: Metadata = { title: 'Account security' };

/**
 * The operator's second factors (C22): authenticator apps (TOTP) and security keys (WebAuthn),
 * and recovery codes. A session that has not passed the organization's required MFA reaches
 * this page, and only this page, to enrol its first factor.
 */
export default async function SecurityPage() {
  return renderPage({ allowWithoutMfa: true }, async ({ session }) => {
    const factors = (await listMfaFactors()).map(toFactorSummary);
    const hasActive = factors.some((factor) => factor.status === 'active');
    // 2B F002: once the user has an active factor, a session that did not pass MFA can neither
    // enrol nor remove factors; it must sign in with the factor.
    const mustSignInAgain = !session.mfaSatisfied && hasActive;

    return (
      <PageMain width="narrow">
        <PageHeader
          title="Account security"
          description="Second factors protect your account when someone learns your password."
        />
        {/* C168.4: the operator's own sessions; adding a factor signs the others out. */}
        <p className="text-sm">
          <Link href="/account/sessions" className={LINK_CLASS}>
            {SETTINGS_COPY.sessions.securityLink}
          </Link>{' '}
          <span className="text-ink-muted">{SETTINGS_COPY.sessions.enrolmentNote}</span>
        </p>
        {mustSignInAgain ? (
          <section
            aria-labelledby="sign-in-again"
            className="flex flex-col items-start gap-3 rounded-xl border border-line bg-surface p-6"
          >
            <h2 id="sign-in-again" className="text-lg font-semibold">
              Sign in again with your second factor
            </h2>
            <p className="text-sm text-ink-muted">
              Your account has a second factor now. This session started before it was added, so
              sign in again and use it.
            </p>
            <form action={signInAgain}>
              <Button type="submit">Sign in again</Button>
            </form>
          </section>
        ) : (
          <>
            {!session.mfaSatisfied && (
              <Alert tone="warning" title="Your organization requires a second factor">
                Add an authenticator app or a security key to use the dashboard.
              </Alert>
            )}
            <MfaFactorTable factors={factors} remove={removeMfaFactor} canRemove />
            <div className="flex flex-wrap gap-3">
              <TotpEnrolment start={startTotpEnrolment} confirm={confirmTotpEnrolment} />
              <WebauthnEnrolment start={startWebauthnEnrolment} finish={finishWebauthnEnrolment} />
            </div>
            {session.mfaSatisfied && hasActive && (
              <section aria-labelledby="recovery-codes" className="flex flex-col items-start gap-2">
                <h2 id="recovery-codes" className="text-lg font-semibold">
                  Recovery codes
                </h2>
                <p className="text-sm text-ink-muted">
                  Each code signs you in once when your second factor is not at hand.
                </p>
                <RecoveryCodesButton regenerate={regenerateCodes} />
              </section>
            )}
          </>
        )}
      </PageMain>
    );
  });
}
