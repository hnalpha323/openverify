/**
 * C66: the `verification/email-address` evidence, owned by `dashboard-people` (Workflow 5C): the
 * address exactly as the API sent it to this operator ("Hidden" without `pii:view`, "Redacted"
 * after a redaction, C53.7), when its code was confirmed, the accepted sends and the wrong
 * entries, the channel, the limit that refused the user when one did (C55.6), what the
 * disposable-domain and mail-domain checks found (C56), and what a pass means
 * (`docs/checks/contact.md`). A server component that reads only the verification answer.
 */
import {
  emailDomainEvidenceOf,
  type DisposableEvidence,
  type MxEvidence,
} from '../../lib/email-address-evidence';
import {
  EMAIL_ADDRESS_PASS_MEANS,
  disposableMatchText,
  matchDepthText,
  mxRouteText,
} from '../../lib/email-address-words';
import { otpEvidenceOf } from '../../lib/otp-evidence';
import { Detail } from '../detail';
import { GenericEvidence, type EvidenceProps } from './generic';
import { OtpDetails } from './otp-details';
import { NotRecorded, PassMeans, PersonalValue, Words } from './parts';

/** Where the match was: "Matched on the address's own domain", "Matched 3 levels above …". */
function matchedWhere(depth: number): string {
  const where = matchDepthText(depth);
  return depth < 2
    ? `Matched on ${where.charAt(0).toLowerCase()}${where.slice(1)}`
    : `Matched ${where}`;
}

function Disposable({ evidence }: { readonly evidence: DisposableEvidence }) {
  return (
    <span className="flex flex-col">
      <Words text={disposableMatchText(evidence.match)} code={evidence.match} />
      {evidence.depth !== null && (
        <span className="text-xs text-ink-muted">{matchedWhere(evidence.depth)}</span>
      )}
    </span>
  );
}

function MailDomain({ evidence }: { readonly evidence: MxEvidence }) {
  const { recordCount } = evidence;
  return (
    <span className="flex flex-col">
      <Words text={mxRouteText(evidence.route)} code={evidence.route} />
      {recordCount !== null && (
        <span className="text-xs text-ink-muted">
          {String(recordCount)} {recordCount === 1 ? 'record' : 'records'}
        </span>
      )}
    </span>
  );
}

export function EmailAddressEvidence({ verification, label, state }: EvidenceProps) {
  if (verification.type !== 'verification/email-address') {
    return <GenericEvidence verification={verification} label={label} state={state} />;
  }
  const evidence = otpEvidenceOf(verification);
  const domain = emailDomainEvidenceOf(verification);
  const ran = verification.attributes.checks.length > 0;
  return (
    <div role="group" aria-label={`${label} evidence`} className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Detail term="Email address">
          <PersonalValue value={evidence.destination} state={state} />
        </Detail>
        <OtpDetails evidence={evidence} ran={ran} />
        <Detail term="Disposable-domain lists">
          {domain.disposable === null ? (
            <NotRecorded ran={ran} />
          ) : (
            <Disposable evidence={domain.disposable} />
          )}
        </Detail>
        <Detail term="Mail domain">
          {domain.mx === null ? <NotRecorded ran={ran} /> : <MailDomain evidence={domain.mx} />}
        </Detail>
      </dl>
      <PassMeans text={EMAIL_ADDRESS_PASS_MEANS} />
    </div>
  );
}
