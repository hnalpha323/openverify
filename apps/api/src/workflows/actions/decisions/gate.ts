/**
 * C128.3, C128.4: the gates of an adverse step at run time. In production a solely automated decision
 * needs its declared basis and a contest route, and a biometric one its `biometric-basis`; with
 * `explicit-consent`, the inquiry must have recorded the consents the step rests on, read at the
 * decision. What stops here sends the subject to review (`review.ts`) and ends the step with the code.
 */
import { getEffectiveConsent, type Db } from '@openverify/db';
import type { RunDecisionFacts } from '../../../services/decisions/record.js';
import type { ActionContext } from '../../engine/action-port.js';

const BIOMETRIC_CONSENT = 'consent.biometric';
const MATCHING_CONSENT = 'consent.biometric-matching';
const AUTOMATED_DECISION_CONSENT = 'consent.automated-decision';

export interface AdverseGate {
  facts: RunDecisionFacts;
  /** C128.4 (i)-(iii), or the action's own flag. */
  biometric: boolean;
  /** The inquiry a biometric decision rests on; `null` when no inquiry is in scope. */
  inquiryId: string | null;
  /** C128.4: a face list needs `consent.biometric-matching` too. */
  faceList?: boolean;
}

export type AdverseRefusal = 'decision_basis_missing' | 'biometric_consent_missing';

async function consentHolds(
  tx: Db,
  environmentId: string,
  inquiryId: string | null,
  faceList: boolean,
): Promise<boolean> {
  if (inquiryId === null) {
    return false;
  }
  const consent = await getEffectiveConsent(tx, { environmentId, inquiryId, sessionId: null });
  if (consent === null) {
    return false;
  }
  const given = new Set([...consent.textKeys, ...(consent.optionalTextKeys ?? [])]);
  return (
    given.has(BIOMETRIC_CONSENT) &&
    given.has(AUTOMATED_DECISION_CONSENT) &&
    (!faceList || given.has(MATCHING_CONSENT))
  );
}

/** What stops this adverse step, or `null`. */
export async function adverseRefusal(
  tx: Db,
  context: Pick<ActionContext, 'environmentId' | 'environmentKind'>,
  { facts, biometric, inquiryId, faceList = false }: AdverseGate,
): Promise<AdverseRefusal | null> {
  const production = context.environmentKind === 'production';
  if (
    production &&
    facts.solelyAutomated === true &&
    (facts.decisionBasis == null || facts.contestRoute == null)
  ) {
    return 'decision_basis_missing';
  }
  if (production && biometric && facts.biometricBasis == null) {
    return 'decision_basis_missing';
  }
  // A declared consent is checked whatever the static rule read of the step.
  if (
    facts.biometricBasis === 'explicit-consent' &&
    !(await consentHolds(tx, context.environmentId, inquiryId, faceList))
  ) {
    return 'biometric_consent_missing';
  }
  return null;
}
