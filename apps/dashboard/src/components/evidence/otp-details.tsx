/**
 * The one-time code details a phone and an email address verification share (C52.8, C55, C66),
 * as terms of the evidence list: when the code was confirmed, the accepted sends, the wrong
 * entries, the channel, the sender (labelled when it is the sandbox one, ADR 0002 §3d) and, when
 * one did, the limit that refused the user (C55.6). None of them
 * is personal data, so each shows whatever the operator's role.
 */
import type { OtpEvidence } from '../../lib/otp-evidence';
import { OTP_SANDBOX_SENDER_TEXT, otpChannelText, otpLimitedReasonText } from '../../lib/otp-words';
import { Detail } from '../detail';
import { EmptyValue } from '../masked-value';
import { Timestamp } from '../timestamp';
import { Code, NotRecorded, Words } from './parts';

function Count({ value }: { readonly value: number | null }) {
  return value === null ? <EmptyValue /> : <>{String(value)}</>;
}

function Confirmed({ at }: { readonly at: string | null | undefined }) {
  if (at === undefined) {
    return <EmptyValue />;
  }
  return at === null ? (
    <span className="text-ink-muted">Not confirmed</span>
  ) : (
    <Timestamp value={at} />
  );
}

export function OtpDetails({
  evidence,
  ran,
}: {
  readonly evidence: OtpEvidence;
  /** Whether the checks ran: before that, the comparison recorded nothing yet. */
  readonly ran: boolean;
}) {
  const { channel, limitedReason } = evidence;
  const channelWords = channel === null ? undefined : otpChannelText(channel);
  return (
    <>
      <Detail term="Confirmed (UTC)">
        <Confirmed at={evidence.confirmedAt} />
      </Detail>
      <Detail term="Sends">
        <Count value={evidence.sends} />
      </Detail>
      <Detail term="Failed attempts">
        <Count value={evidence.failedAttempts} />
      </Detail>
      <Detail term="Channel">
        {channel === null ? (
          <NotRecorded ran={ran} />
        ) : (
          <Words
            text={channelWords === undefined ? undefined : { words: channelWords }}
            code={channel}
          />
        )}
      </Detail>
      <Detail term="Sent through">
        {evidence.sender === null ? (
          <NotRecorded ran={ran} />
        ) : (
          <span className="flex flex-col">
            <Code>{evidence.sender.id}</Code>
            {/* ADR 0002 §3d: a sandbox provider is labelled as one. */}
            {evidence.sender.sandbox && (
              <span className="text-xs text-ink-muted">{OTP_SANDBOX_SENDER_TEXT}</span>
            )}
          </span>
        )}
      </Detail>
      {limitedReason !== null && (
        <Detail term="Refused by">
          <Words text={otpLimitedReasonText(limitedReason)} code={limitedReason} />
        </Detail>
      )}
    </>
  );
}
