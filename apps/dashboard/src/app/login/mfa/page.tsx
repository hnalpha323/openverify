import { Card } from '@openverify/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MfaLogin } from '../../../components/mfa-login';
import { getMfaChallenge } from '../../../lib/mfa-challenge';
import {
  cancelMfaLogin,
  completeMfa,
  finishWebauthnLogin,
  startWebauthnLogin,
} from '../../actions/auth';

export const metadata: Metadata = { title: 'Confirm it is you' };

/**
 * The second step of signing in (C22). The page knows the challenge only from its httpOnly
 * cookie, and hands the browser nothing but the factor types to offer.
 */
export default async function MfaPage() {
  const challenge = await getMfaChallenge();
  if (challenge === null) {
    redirect('/login?reason=mfa-expired');
  }
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <Card title="Confirm it is you" headingLevel={1} className="w-full max-w-sm">
        <MfaLogin
          factors={challenge.factors}
          completeMfa={completeMfa}
          startWebauthnLogin={startWebauthnLogin}
          finishWebauthnLogin={finishWebauthnLogin}
          cancelMfaLogin={cancelMfaLogin}
        />
      </Card>
    </main>
  );
}
