/**
 * C128.1 (H10, H13): what a decision on an inquiry considered, as codes and ids only: each
 * verification's status, each check's name and status, each report and its status, each list match,
 * each signal's name, with the tier, stage and confidence of an H-tier input, and what was still
 * pending. Never a value: the resource's schema refuses anything but a code in `name` and `status`.
 */
import { REPORT_REGISTRY, getCheckDefinition, getSignalDefinition } from '@openverify/core';
import {
  getReports,
  listInquiryReportIds,
  listInquiryVerifications,
  listListMatches,
  listPendingDecisionEvidence,
  type Db,
  type DecisionEvidence,
  type DecisionPendingEvidence,
  type Inquiry,
} from '@openverify/db';

export interface InquiryEvidence {
  evidence: DecisionEvidence[];
  pendingEvidence: DecisionPendingEvidence[];
}

/** C128.1: at most this many rows of one kind: a record stays a record (ours, provisional). */
const EVIDENCE_CAP = 200;

const reportTier = (tiers: readonly string[]): string =>
  tiers.includes('H') ? 'H' : (tiers[0] ?? 'R');

async function verificationEvidence(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<DecisionEvidence[]> {
  const verifications = await listInquiryVerifications(db, environmentId, inquiryId);
  return verifications.flatMap(({ id, status, checks }) => [
    { kind: 'verification', id, name: null, status, tier: 'R', stage: 'ga', confidence: null },
    ...checks.map(({ name, status: checkStatus }) => {
      const definition = getCheckDefinition(name);
      return {
        kind: 'check',
        id: null,
        name,
        status: checkStatus,
        tier: definition?.tier ?? 'R',
        stage: definition?.stage ?? 'ga',
        confidence: null,
      };
    }),
  ]);
}

async function reportEvidence(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<DecisionEvidence[]> {
  const ids = await listInquiryReportIds(db, environmentId, inquiryId);
  const reports = await getReports(db, environmentId, ids);
  return reports.map(({ id, status, reportType }) => {
    const { tiers, stage } = REPORT_REGISTRY[reportType];
    return {
      kind: 'report',
      id,
      name: reportType.replaceAll('-', '_'),
      status,
      tier: reportTier(tiers),
      stage,
      confidence: null,
    };
  });
}

async function listMatchEvidence(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<DecisionEvidence[]> {
  const { items } = await listListMatches(
    db,
    environmentId,
    { inquiryIds: [inquiryId] },
    { size: 100 },
  );
  return items.map(({ id, method, status, confidence, tier }) => ({
    kind: 'list-match',
    id,
    name: method,
    status,
    tier,
    // C122.1: an H-tier method is `beta`.
    stage: tier === 'H' ? 'beta' : 'ga',
    confidence,
  }));
}

function signalEvidence(inquiry: Pick<Inquiry, 'signals'>): DecisionEvidence[] {
  return (inquiry.signals ?? []).flatMap(({ name }) => {
    const definition = getSignalDefinition(name);
    return definition === undefined
      ? []
      : [
          {
            kind: 'signal',
            id: null,
            name,
            status: null,
            tier: definition.tier,
            stage: definition.stage,
            confidence: null,
          },
        ];
  });
}

/** What the inquiry's record holds at this moment, in `db`'s transaction. */
export async function inquiryEvidence(db: Db, inquiry: Inquiry): Promise<InquiryEvidence> {
  const { environmentId, id } = inquiry;
  const evidence = [
    ...(await verificationEvidence(db, environmentId, id)),
    ...(await reportEvidence(db, environmentId, id)),
    ...(await listMatchEvidence(db, environmentId, id)),
    ...signalEvidence(inquiry),
  ];
  return {
    evidence: evidence.slice(0, EVIDENCE_CAP),
    pendingEvidence: await listPendingDecisionEvidence(db, environmentId, id),
  };
}
