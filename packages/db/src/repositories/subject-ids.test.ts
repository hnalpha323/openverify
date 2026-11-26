import { describe, expect, it } from 'vitest';
import { testId } from '../testing.js';
import { REDACTION_SUBJECT_ID_PREFIXES, subjectIdsIn } from './subject-ids.js';

describe('subjectIdsIn (2B F005, F017)', () => {
  it('names inquiries, verifications, sessions and accounts', () => {
    // C40.1: and selfie captures.
    // C73.5: and reports.
    // C107.5 (Workflow 7A): and a session's network evaluations and devices.
    // C107.5 (Workflow 7B (T)): and transactions, their files and their labels.
    // C107.5 (Workflow 7B (L)): and lists, their items, list matches and importers.
    // C107.5 (Workflow 7B (G)): and graph queries.
    // C143.5 (Workflow 8A): and workflow runs.
    expect(REDACTION_SUBJECT_ID_PREFIXES).toEqual([
      'inq',
      'ver',
      'iqse',
      'acc',
      'self',
      'rep',
      'net',
      'dev',
      'lst',
      'libf',
      'lidf',
      'lic',
      'liea',
      'lifc',
      'ligl',
      'ligin',
      'liif',
      'liip',
      'lin',
      'lipn',
      'lisb',
      'lis',
      'lmt',
      'mprt',
      'idec',
      'txn',
      'txnf',
      'txnl',
      'grphq',
      'wfr',
      'case',
      'cscm',
      'catt',
    ]);
  });

  it('finds every subject id in nested JSON, strings and truncated previews, once, sorted', () => {
    const [inquiry, verification, session, account] = [
      testId('inq'),
      testId('ver'),
      testId('iqse'),
      testId('acc'),
    ];

    const ids = subjectIdsIn(
      `/api/v1/inquiries/${inquiry}/redact`,
      { data: [{ id: inquiry, relationships: { account: { data: { id: account } } } }] },
      { truncated: true, preview: JSON.stringify({ included: [{ id: verification }] }) },
      JSON.stringify({ data: { id: session } }),
      null,
      undefined,
    );

    expect(ids).toEqual([account, inquiry, session, verification].sort());
  });

  it('ignores ids of other objects and strings that only look like ids', () => {
    const inquiry = testId('inq');

    expect(
      subjectIdsIn({
        template: testId('itmpl'),
        type: testId('acctp'),
        event: testId('evt'),
        cut: inquiry.slice(0, -1),
        glued: `x${inquiry}`,
        server_01: 'server_01M5CJXHG0000000000000000A',
      }),
    ).toEqual([]);
  });
});
