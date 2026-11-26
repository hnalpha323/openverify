/**
 * C66: the `verification/phone-number` evidence, owned by `dashboard-people` (Workflow 5C): the
 * number exactly as the API sent it to this operator ("Hidden" without `pii:view`, "Redacted"
 * after a redaction, C53.7), when its code was confirmed, the accepted sends and the wrong
 * entries, the channel, the limit that refused the user when one did (C55.6), and what a pass
 * means (`docs/checks/contact.md`). A server component that reads only the verification answer.
 */
import { otpEvidenceOf } from '../../lib/otp-evidence';
import { PHONE_NUMBER_PASS_MEANS } from '../../lib/phone-number-words';
import { Detail } from '../detail';
import { GenericEvidence, type EvidenceProps } from './generic';
import { OtpDetails } from './otp-details';
import { PassMeans, PersonalValue } from './parts';

export function PhoneNumberEvidence({ verification, label, state }: EvidenceProps) {
  if (verification.type !== 'verification/phone-number') {
    return <GenericEvidence verification={verification} label={label} state={state} />;
  }
  const evidence = otpEvidenceOf(verification);
  return (
    <div role="group" aria-label={`${label} evidence`} className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Detail term="Phone number">
          <PersonalValue value={evidence.destination} state={state} />
        </Detail>
        <OtpDetails evidence={evidence} ran={verification.attributes.checks.length > 0} />
      </dl>
      <PassMeans text={PHONE_NUMBER_PASS_MEANS} />
    </div>
  );
}
