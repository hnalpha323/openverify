import { idSchema, type FileResource, type SelfieCaptureResource } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadSection } from '../../../components/lifecycle/section-data';
import { ObjectPrintButton, ObjectPrintFooter } from '../../../components/print/object-print';
import { recordObjectPrint } from '../../../components/print/print-actions';
import { VerificationView } from '../../../components/verification-view';
import { getInquiry } from '../../../lib/api/inquiries';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { getVerificationWithFiles } from '../../../lib/api/verification-files';
import './print.css';

export const metadata: Metadata = { title: 'Verification' };

export interface VerificationPageProps {
  readonly params: Promise<{ id: string }>;
}

/**
 * One verification (C26, `verifications:read`): `GET /verifications/:id?include=selfies` for its
 * status, checks and, for a selfie, its captures (C40.1, C47), and, with `inquiries:read`, its
 * inquiry from the dashboard API for the files' kinds and the inquiry's redaction. Linked from the
 * inquiry page's verification cards and timeline.
 */
export default async function VerificationPage({ params }: VerificationPageProps) {
  const { id } = await params;
  if (!idSchema('ver').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['verifications:read'] }, async ({ api, session }) => {
    // C173.2: the verification with its files (metadata only); the route takes one include, so a
    // selfie's captures are a second read.
    const { data: verification, included: withFiles = [] } = await getVerificationWithFiles(id);
    const files = withFiles.filter(
      (resource): resource is FileResource => resource.type === 'file',
    );
    const included =
      verification.type === 'verification/selfie'
        ? ((await api.verifications.retrieve(id, { include: 'selfies' })).included ?? [])
        : [];
    const captures = included.filter(
      (resource): resource is SelfieCaptureResource => resource.type === 'selfie',
    );
    const inquiry = await loadSection(hasPermission(session, 'inquiries:read'), () =>
      getInquiry(verification.relationships.inquiry.data.id),
    );
    return (
      <div data-verification-print="">
        <VerificationView
          verification={verification}
          captures={captures}
          inquiry={inquiry}
          piiView={hasPermission(session, 'pii:view')}
          ownFileResources={files}
          print={{
            button: <ObjectPrintButton objectId={verification.id} action={recordObjectPrint} />,
            footer: (
              <ObjectPrintFooter
                kind="verification"
                environment={session.environment.kind}
                objectId={verification.id}
                operatorId={session.user.id}
                personalData={hasPermission(session, 'pii:view')}
              />
            ),
          }}
        />
      </div>
    );
  });
}
