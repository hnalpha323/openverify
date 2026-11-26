/**
 * C61.3–C61.5, C66: the `verification/business-website` evidence. It shows:
 * - what a pass means, and what it does not;
 * - the URL and host the user entered (personal data: a personal site can name its owner);
 * - the resolution, the required core, and how it was read: the sandbox rule for reserved names,
 *   or the DNS answer as address counts, never an address;
 * - the domain's registration day and its age against the template's minimum, an advisory result,
 *   or why the age is unavailable;
 * - the malicious-website listings and the backlinks, or that the template does not run them.
 * Each result names its provider, labelled sandbox.
 *
 * Everything comes from this verification answer, which the API masked per operator (C53.7): the
 * URL and host read "Hidden" without `pii:view` and "Redacted" after a redaction; the
 * registration day is public registry data, never masked. A server component; the only export is
 * the component (`index.test.tsx`).
 */
import type { ReactNode } from 'react';
import { reasonText } from '../../lib/check-reasons';
import {
  businessWebsiteEvidenceOf,
  type BusinessWebsiteEvidenceData,
  type WebsiteCheckEvidence,
} from '../../lib/business-website-evidence';
import {
  BUSINESS_WEBSITE_PASS_MEANING,
  domainAgeFlagText,
  resolutionRouteText,
} from '../../lib/business-website-words';
import { requirementText } from '../../lib/database-words';
import { Detail } from '../detail';
import { RedactedValue } from '../lifecycle/redacted-value';
import { MaskedValue } from '../masked-value';
import { Badge, CheckStatusBadge } from '../status-badge';
import { GenericEvidence, type EvidenceProps, type EvidenceState } from './generic';

const muted = (text: string) => <span className="text-ink-muted">{text}</span>;
const code = (text: string) => <code className="font-mono text-xs break-all">{text}</code>;
const line = (content: ReactNode) => <span className="mt-1 block">{content}</span>;

/** `count` and its noun, singular for one. */
const counted = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

function Explained({
  words,
  explanation,
}: {
  readonly words: string;
  readonly explanation?: string;
}) {
  return (
    <>
      <span>{words}</span>
      {explanation !== undefined && (
        <span className="block text-xs text-ink-muted">{explanation}</span>
      )}
    </>
  );
}

/** One personal attribute: "Hidden" when masked, "Redacted" after a redaction. */
function PersonalValue({
  value,
  state,
}: {
  readonly value: unknown;
  readonly state: EvidenceState;
}) {
  const text = typeof value === 'string' ? value : null;
  if (state === 'redacted' && text === null) {
    return <RedactedValue />;
  }
  return <MaskedValue value={text} masked={state === 'hidden'} />;
}

/** A website check's result, whether it is required or advisory, its reasons and its provider. */
function Result({
  check,
  evidence,
}: {
  readonly check: WebsiteCheckEvidence;
  readonly evidence: BusinessWebsiteEvidenceData;
}) {
  const { outcome, provider } = check;
  if (outcome === null) {
    return evidence.ran
      ? muted('Not checked: the template does not run this check')
      : muted('No result yet');
  }
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <CheckStatusBadge status={outcome.status} />
      <span>{requirementText(outcome.required)}</span>
      {outcome.reasons.map((reason) => (
        <span key={reason}>{reasonText(reason, outcome.name)?.words ?? code(reason)}</span>
      ))}
      {provider !== null && (
        <span className="flex items-center gap-1">
          {code(provider.id)}
          {provider.sandbox && <Badge status="sandbox" label="Sandbox provider" tone="attention" />}
        </span>
      )}
    </span>
  );
}

function Resolution({ evidence }: { readonly evidence: BusinessWebsiteEvidenceData }) {
  const { route, addresses, publicAddresses } = evidence.resolution;
  const text = route === null ? undefined : resolutionRouteText(route);
  return (
    <>
      <Result check={evidence.resolution} evidence={evidence} />
      {route !== null && line(text === undefined ? code(route) : <Explained {...text} />)}
      {addresses !== null &&
        line(
          `${counted(addresses, 'address', 'addresses')}, ${String(publicAddresses ?? 0)} public`,
        )}
    </>
  );
}

function RegisteredOn({
  value,
  evidence,
  state,
}: {
  readonly value: unknown;
  readonly evidence: BusinessWebsiteEvidenceData;
  readonly state: EvidenceState;
}) {
  // C52.8: midnight UTC of the registration day; the day is shown as served, never parsed.
  if (typeof value === 'string') {
    return <>{value.slice(0, 10)}</>;
  }
  if (state === 'redacted') {
    return <RedactedValue />;
  }
  return muted(evidence.ran ? 'Not available' : 'Not recorded yet');
}

function DomainAge({
  evidence,
  state,
}: {
  readonly evidence: BusinessWebsiteEvidenceData;
  readonly state: EvidenceState;
}) {
  const { outcome, ageDays, minimumDays, flags } = evidence.domainAge;
  let age: ReactNode = null;
  if (ageDays !== null) {
    const old = `${counted(ageDays, 'day', 'days')} old`;
    age =
      minimumDays === null ? old : `${old}; the minimum is ${counted(minimumDays, 'day', 'days')}`;
  } else if (outcome !== null && state === 'redacted') {
    age = <RedactedValue />;
  } else if (outcome !== null && minimumDays !== null) {
    age = `The minimum is ${counted(minimumDays, 'day', 'days')}`;
  }
  return (
    <>
      <Result check={evidence.domainAge} evidence={evidence} />
      {age !== null && line(age)}
      {flags.length > 0 && (
        <ul aria-label="Domain age flags" className="mt-1 flex flex-col gap-1">
          {flags.map((flag) => {
            const text = domainAgeFlagText(flag);
            return <li key={flag}>{text === undefined ? code(flag) : <Explained {...text} />}</li>;
          })}
        </ul>
      )}
    </>
  );
}

function Listings({
  evidence,
  state,
}: {
  readonly evidence: BusinessWebsiteEvidenceData;
  readonly state: EvidenceState;
}) {
  const { outcome, feeds } = evidence.listings;
  let detail: ReactNode = null;
  if (feeds !== null) {
    detail = `Checked against ${counted(feeds, 'feed', 'feeds')}`;
  } else if (outcome !== null && state === 'redacted') {
    detail = <RedactedValue />;
  }
  return (
    <>
      <Result check={evidence.listings} evidence={evidence} />
      {detail !== null && line(detail)}
    </>
  );
}

function Backlinks({
  evidence,
  state,
}: {
  readonly evidence: BusinessWebsiteEvidenceData;
  readonly state: EvidenceState;
}) {
  const { outcome, count, threshold } = evidence.backlinks;
  let detail: ReactNode = null;
  if (count !== null) {
    const links = counted(count, 'backlink', 'backlinks');
    detail = threshold === null ? links : `${links}; the minimum is ${String(threshold)}`;
  } else if (outcome !== null && state === 'redacted') {
    detail = <RedactedValue />;
  }
  return (
    <>
      <Result check={evidence.backlinks} evidence={evidence} />
      {detail !== null && line(detail)}
    </>
  );
}

/** C66: the evidence of a `verification/business-website` (C54.5). */
export function BusinessWebsiteEvidence(props: EvidenceProps) {
  const { verification, label, state } = props;
  if (verification.type !== 'verification/business-website') {
    return <GenericEvidence {...props} />;
  }
  const evidence = businessWebsiteEvidenceOf(verification);
  const { attributes } = verification;
  return (
    <div role="group" aria-label={`${label} evidence`} className="flex flex-col gap-5">
      <p className="text-sm">
        <span className="font-medium">What a pass means: </span>
        {BUSINESS_WEBSITE_PASS_MEANING}
      </p>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Detail term="Website address">
          <PersonalValue value={attributes['website-url']} state={state} />
        </Detail>
        <Detail term="Domain">
          <PersonalValue value={attributes['website-domain']} state={state} />
        </Detail>
        <Detail term="Resolution">
          <Resolution evidence={evidence} />
        </Detail>
        <Detail term="Registered on">
          <RegisteredOn
            value={attributes['domain-registered-at']}
            evidence={evidence}
            state={state}
          />
        </Detail>
        <Detail term="Domain age">
          <DomainAge evidence={evidence} state={state} />
        </Detail>
        <Detail term="Malicious-website listings">
          <Listings evidence={evidence} state={state} />
        </Detail>
        <Detail term="Backlinks">
          <Backlinks evidence={evidence} state={state} />
        </Detail>
      </dl>
    </div>
  );
}
