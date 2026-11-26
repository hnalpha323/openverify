/**
 * The decision records of a subject (C128.1, C142.4), newest first as the API serves them: who
 * decided, whether a person took part, the basis and contest route, the evidence with each H-tier
 * input's tier, stage and confidence, and what was still pending. Values are what the API sent:
 * the comment arrives `null` without PII visibility, and the console never unmasks it.
 */
import type { DecisionResource } from '@openverify/contracts';
import { Alert } from '@openverify/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Detail } from '../detail';
import { LINK_CLASS } from '../link-styles';
import { Timestamp } from '../timestamp';
import {
  BIOMETRIC_BASIS_WORDS,
  DECISION_BASIS_WORDS,
  DECISION_ERROR_WORDS,
  DECISION_EVIDENCE_WORDS,
  DECISION_KIND_WORDS,
  DECISION_PENDING_WORDS,
  solelyAutomatedWords,
} from './decision-words';

type Attributes = DecisionResource['attributes'];

const code = (value: string) => <code className="font-mono text-xs break-all">{value}</code>;

/** The run page of a `wfr_` id. */
export const runHref = (runId: string) => `/workflows/runs/${runId}`;

function actorOf(actor: Attributes['actor']): ReactNode {
  switch (actor.type) {
    case 'workflow-run':
      return (
        <>
          Workflow run{' '}
          <Link href={runHref(actor.id)} className={LINK_CLASS}>
            {code(actor.id)}
          </Link>
        </>
      );
    case 'api-key':
      return <>API key {code(actor.id)}</>;
    case 'user':
      return <>User {code(actor.id)}</>;
    // C150.7 (Phase 9): the inquiry's own flow, named by the inquiry it decided.
    case 'inquiry-flow':
      return <>The inquiry's flow {code(actor.id)}</>;
  }
}

function contestRouteOf(route: Attributes['contest-route']): ReactNode {
  if (route === null) {
    return 'Not declared';
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {route.url !== undefined && (
        <li>
          {/* C128.7: the host first, so the reader sees where the link goes. */}
          {new URL(route.url).host}: {code(route.url)}
        </li>
      )}
      {route.contact !== undefined && <li>{route.contact}</li>}
      {route['case-template-id'] !== undefined && (
        <li>Review case template {code(route['case-template-id'])}</li>
      )}
    </ul>
  );
}

function evidenceOf(evidence: Attributes['evidence']): ReactNode {
  if (evidence.length === 0) {
    return 'None recorded';
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {evidence.map((item, index) => {
        const named = item.id ?? item.name ?? '';
        const parts = [
          `${item.tier} tier`,
          ...(item.tier === 'H' ? [item.stage] : []),
          ...(item.confidence === null ? [] : [`confidence ${String(item.confidence)}`]),
        ];
        return (
          <li key={`${item.kind}-${named}-${String(index)}`}>
            {`${DECISION_EVIDENCE_WORDS[item.kind]} ${named}: ${item.status ?? 'no status'} · ${parts.join(' · ')}`}
          </li>
        );
      })}
    </ul>
  );
}

function pendingOf(pending: Attributes['pending-evidence']): ReactNode {
  if (pending.length === 0) {
    return 'Nothing';
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {pending.map((item, index) => (
        <li key={`${item.kind}-${item.id ?? item.name ?? ''}-${String(index)}`}>
          {`${DECISION_PENDING_WORDS[item.kind]} ${item.id ?? item.name ?? ''} still pending`}
        </li>
      ))}
    </ul>
  );
}

function commentOf(comment: string | null, piiView: boolean, redacted: boolean): ReactNode {
  if (comment !== null) {
    return <span className="whitespace-pre-wrap">{comment}</span>;
  }
  if (redacted) {
    return 'Redacted';
  }
  return piiView ? 'None' : 'Hidden without pii:view';
}

function DecisionRecord({
  record,
  piiView,
  redacted,
}: {
  readonly record: DecisionResource;
  readonly piiView: boolean;
  readonly redacted: boolean;
}) {
  const { attributes } = record;
  const headingId = `decision-${record.id}`;
  const humanStep = attributes['human-step'];
  const errorCode = attributes['error-code'];
  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded border border-line p-4"
    >
      <h3 id={headingId} className="text-base font-semibold">
        {DECISION_KIND_WORDS[attributes.kind]}
      </h3>
      <p className="text-xs text-ink-muted">
        <Timestamp value={attributes['created-at']} /> UTC · {code(record.id)}
      </p>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Detail term="Decided by">{actorOf(attributes.actor)}</Detail>
        <Detail term="Solely automated">
          {solelyAutomatedWords(attributes['solely-automated'])}
        </Detail>
        <Detail term="Person who took part">
          {humanStep === null ? (
            'None'
          ) : (
            <>
              Case resolution by {code(humanStep['actor-id'])},{' '}
              {humanStep['resolved-via'] === 'single'
                ? 'resolved on its own (not in bulk)'
                : 'resolved in bulk'}
            </>
          )}
        </Detail>
        <Detail term="Decision basis">
          {attributes['decision-basis'] === null
            ? 'Not declared'
            : DECISION_BASIS_WORDS[attributes['decision-basis']]}
        </Detail>
        {attributes['biometric-basis'] !== null && (
          <Detail term="Biometric basis">
            {BIOMETRIC_BASIS_WORDS[attributes['biometric-basis']]}
          </Detail>
        )}
        <Detail term="Contest route">{contestRouteOf(attributes['contest-route'])}</Detail>
        <Detail term="Evidence considered">{evidenceOf(attributes.evidence)}</Detail>
        <Detail term="Pending at the decision">{pendingOf(attributes['pending-evidence'])}</Detail>
        <Detail term="Comment">{commentOf(attributes.comment, piiView, redacted)}</Detail>
        {errorCode !== null && (
          <Detail term="Stopped by">
            {errorCode}: {DECISION_ERROR_WORDS[errorCode] ?? 'a publish gate'}
          </Detail>
        )}
        {attributes['needs-review'] && <Detail term="Needs review">Yes</Detail>}
        {attributes['test-run-id'] !== null && (
          <Detail term="Test run">
            <Link href={runHref(attributes['test-run-id'])} className={LINK_CLASS}>
              {code(attributes['test-run-id'])}
            </Link>
          </Detail>
        )}
      </dl>
    </article>
  );
}

export function DecisionRecords({
  records,
  piiView,
  redacted,
  emptyMessage,
  actions,
}: {
  readonly records: readonly DecisionResource[];
  readonly piiView: boolean;
  readonly redacted: boolean;
  readonly emptyMessage: string;
  /** The subject's own decision controls, such as reopen. */
  readonly actions?: ReactNode;
}) {
  const pending = records.some((record) => record.attributes['human-review-pending']);
  return (
    <div className="flex flex-col gap-4">
      {pending && (
        <Alert tone="info" title="Human review pending" aria-label="Human review pending">
          Human review is pending: runs and API keys cannot decline this subject until a person
          decides.
        </Alert>
      )}
      {actions}
      {records.length === 0 ? (
        <p className="text-sm text-ink-muted">{emptyMessage}</p>
      ) : (
        records.map((record) => (
          <DecisionRecord key={record.id} record={record} piiView={piiView} redacted={redacted} />
        ))
      )}
    </div>
  );
}
