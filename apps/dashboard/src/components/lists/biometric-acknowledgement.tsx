import type { BiometricAcknowledgement } from '../../lib/api/lists';
import { Badge } from '../status-badge';

const REFUSED =
  'Creating a face or background list is refused (biometric_lists_not_acknowledged) until an administrator records the basis for biometric lists in Settings.';

/**
 * The face and background acknowledgement (C97.4) as the console knows it: the
 * `biometric-lists-basis` setting with `settings:read`, and otherwise what the API answers. Face and
 * background lists are advisory, H-tier and provisional; nothing here declines anyone.
 */
export function BiometricAcknowledgementState({
  acknowledgement,
}: {
  readonly acknowledgement: BiometricAcknowledgement;
}) {
  const headingId = 'biometric-lists-acknowledgement';
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 text-sm"
    >
      <h2 id={headingId} className="text-base font-semibold">
        Face and background lists
      </h2>
      {acknowledgement.kind === 'unreadable' ? (
        <p>{REFUSED} Reading that setting needs settings:read.</p>
      ) : acknowledgement.basis === null ? (
        <p>
          <Badge status="not-acknowledged" label="Not acknowledged" tone="attention" />{' '}
          <span>Not acknowledged. {REFUSED}</span>
        </p>
      ) : (
        <>
          <p>
            <Badge status="acknowledged" label="Acknowledged" tone="neutral" /> The basis recorded
            for biometric lists:
          </p>
          <blockquote className="border-s-2 border-line ps-3">{acknowledgement.basis}</blockquote>
        </>
      )}
      <p className="text-ink-muted">
        A face or background list is advisory: a match marks an inquiry for review when its template
        asks for it, and never declines anyone. Its items come from inquiries with biometric
        matching consent, and are kept at most as long as the face template retention.
      </p>
    </section>
  );
}
