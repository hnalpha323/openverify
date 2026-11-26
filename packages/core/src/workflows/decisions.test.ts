import { describe, expect, it } from 'vitest';
import { DEFAULT_LIST_PURPOSE, LIST_PURPOSES } from '../lists.js';
import {
  BIOMETRIC_BASES,
  DECISION_ACTOR_TYPES,
  DECISION_BASES,
  DECISION_EVIDENCE_KINDS,
  DECISION_HUMAN_STEP_KINDS,
  DECISION_KINDS,
  DECISION_PENDING_EVIDENCE_KINDS,
  DECISION_RESOLVED_VIA,
  DECISION_SUBJECT_TYPES,
  DEFAULT_TRANSACTION_ADVERSE_STATUSES,
  INQUIRY_DECISION_ACTOR_TYPES,
} from './decisions.js';

describe('the decision vocabularies (C128)', () => {
  it('records every decision, a review and a reopen (C128.1, C128.6)', () => {
    expect(DECISION_KINDS).toEqual([
      'approve',
      'decline',
      'review',
      'reopen',
      'adverse',
      // C150.7 (Phase 9): an inquiry failed on a flow path that read more than a verification's outcome.
      'flow-failure',
    ]);
  });

  it('names who decided, and no one else (C128.1)', () => {
    expect(DECISION_ACTOR_TYPES).toEqual(['user', 'api-key', 'workflow-run']);
  });

  it('lets an inquiry flow decide an inquiry, and nothing else (C150.7)', () => {
    // A flow-failure record's actor is the flow, named by the inquiry's id; a transaction review or
    // a device's trust is never a flow's, so DECISION_ACTOR_TYPES stays as it is.
    expect(INQUIRY_DECISION_ACTOR_TYPES).toEqual([
      'user',
      'api-key',
      'workflow-run',
      'inquiry-flow',
    ]);
  });

  it('covers each subject an adverse step reaches (C128)', () => {
    expect(DECISION_SUBJECT_TYPES).toEqual(['inquiry', 'list-item', 'transaction', 'account']);
  });

  it('takes the declared bases of C128.3 and C128.4', () => {
    expect(DECISION_BASES).toEqual(['contract', 'law', 'explicit-consent']);
    expect(BIOMETRIC_BASES).toEqual(['explicit-consent', 'substantial-public-interest']);
  });

  it('counts a person only through a resolved case, and says how it was resolved (C128.2)', () => {
    expect(DECISION_HUMAN_STEP_KINDS).toEqual(['case-resolution']);
    expect(DECISION_RESOLVED_VIA).toEqual(['single', 'bulk']);
  });

  it('keeps evidence as codes and ids, and what was still pending (C128.1)', () => {
    expect(DECISION_EVIDENCE_KINDS).toEqual([
      'check',
      'verification',
      'report',
      'report-match',
      'list-item',
      'list-match',
      'signal',
      'step',
      // C150.7 (Phase 9): the flow's facts, each a code with its tier, never a value.
      'extraction',
      'field',
      'device',
      'account',
      'workflow-output',
    ]);
    expect(DECISION_PENDING_EVIDENCE_KINDS).toEqual([
      'report',
      'list-screening',
      'graph-index',
      'signal',
    ]);
  });

  it('defaults to what fails closed (C122.1)', () => {
    expect(LIST_PURPOSES).toEqual(['block', 'allow', 'watch']);
    expect(DEFAULT_LIST_PURPOSE).toBe('block');
    expect(DEFAULT_TRANSACTION_ADVERSE_STATUSES).toEqual(['declined']);
  });
});
