import { Card } from '@openverify/ui';
import type { Metadata } from 'next';
import { AcceptInvitationForm } from '../../components/accept-invitation-form';
import { acceptInvitation } from '../actions/invitations';

export const metadata: Metadata = { title: 'Accept your invitation' };

/** Where an invitation email leads (`/accept-invitation#token=ovi_...`); no session needed. */
export default function AcceptInvitationPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <Card title="Join OpenVerify" headingLevel={1} className="w-full max-w-sm">
        <div className="flex flex-col gap-5">
          <p className="text-sm text-ink-muted">
            Choose your name and a password to finish setting up your account.
          </p>
          <AcceptInvitationForm action={acceptInvitation} />
        </div>
      </Card>
    </main>
  );
}
