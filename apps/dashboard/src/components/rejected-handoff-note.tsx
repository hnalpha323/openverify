import type { VerificationResource } from '@openverify/contracts';
import { Alert } from '@openverify/ui';

/**
 * C96.3 (K7C-1): marks a verification a rejected phone session created, so a reviewer can tell it
 * from the desktop's own. It is a note, never a status: nothing here declines or fails anything,
 * and a verification without the mark is shown as it always was.
 */
export function RejectedHandoffNote({
  verification,
}: {
  readonly verification: VerificationResource;
}) {
  if (verification.attributes['from-rejected-handoff'] !== true) {
    return null;
  }
  return (
    <Alert tone="info" role="note" title="From a rejected handoff">
      This verification was created on a phone session the desktop rejected with “this was not me”.
      The reject does not change its status.
    </Alert>
  );
}
