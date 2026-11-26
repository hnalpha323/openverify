/**
 * Workflow 8A Stage 3 (`api-actions`; C128.2): `solely-automated` is decided from the path actually
 * executed. The golden cases of C128.2: a timeout, an API-key resolution, a bulk resolution, a user who
 * did not hold `inquiries:write`, a CSV run, and the review recipe's single user resolution. Pure over
 * a definition and a state; the case check is injected, because no case exists in Workflow 8A.
 */
import type { WorkflowDefinition } from '@openverify/contracts';
import { testId } from '@openverify/db/testing';
import type { Db } from '@openverify/db';
import type { JsonValue } from '@openverify/workflow-engine';
import { describe, expect, it } from 'vitest';
import { humanStepOnPath, routesOf, runEvidenceOf } from './facts.js';

const definition = {
  steps: [
    { id: 'review', type: 'wait', mode: 'events', events: ['case.resolved'], subject: 'x' },
    {
      id: 'route',
      type: 'conditional',
      routes: [{ key: 'decline', condition: { '===': [{ var: 'steps.review.event-id' }, 'x'] } }],
    },
    { id: 'lone', type: 'wait', mode: 'events', events: ['case.resolved'], subject: 'x' },
  ],
} as unknown as WorkflowDefinition;

const eventId = testId('evt');
const actor = testId('usr');
const resolved = {
  'resolved-by': 'event',
  'event-id': eventId,
  'event-name': 'case.resolved',
  'resolver-type': 'user',
  'resolver-id': actor,
  'resolved-via': 'single',
  'resolver-held-inquiries-write': true,
};

const humanStep = (review: Record<string, JsonValue> | null, holds = true) =>
  humanStepOnPath(
    {} as Db,
    definition,
    {
      outputs: {
        '': { ...(review === null ? {} : { review }), route: { route: 'decline' } },
      },
    },
    { environmentId: testId('env'), subjectId: testId('inq') },
    () => Promise.resolve(holds),
  );

describe('a person on the path (C128.2)', () => {
  it('counts the review recipe’s single user resolution, and names the wait', async () => {
    expect(await humanStep(resolved)).toEqual({
      kind: 'case-resolution',
      actorId: actor,
      eventId,
      resolvedVia: 'single',
      nodeId: 'review',
    });
  });

  it.each([
    ['a timeout', { ...resolved, 'resolved-by': 'timeout' }],
    ['an API key', { ...resolved, 'resolver-type': 'api-key' }],
    ['a run', { ...resolved, 'resolver-type': 'workflow-run' }],
    ['a bulk resolution', { ...resolved, 'resolved-via': 'bulk' }],
    ['a user without the scope', { ...resolved, 'resolver-held-inquiries-write': false }],
    ['another event', { ...resolved, 'event-name': 'inquiry.completed' }],
  ])('does not count %s', async (_label, output) => {
    expect(await humanStep(output)).toBeNull();
  });

  it('does not count a CSV or API start: no wait ran', async () => {
    expect(await humanStep(null)).toBeNull();
  });

  it('does not count a case that does not hold the subject', async () => {
    expect(await humanStep(resolved, false)).toBeNull();
  });

  it('does not count a wait whose resolution no route read', async () => {
    const found = await humanStepOnPath(
      {} as Db,
      definition,
      { outputs: { '': { lone: resolved, route: { route: 'decline' } } } },
      { environmentId: testId('env'), subjectId: testId('inq') },
      () => Promise.resolve(true),
    );
    expect(found).toBeNull();
  });
});

describe('the path a record keeps (C128.1)', () => {
  it('names each route taken with the digest of its condition', () => {
    const facts = routesOf(definition, {
      outputs: {
        '': { route: { route: 'decline' }, code: { value: 1, 'source-sha256': 'a'.repeat(64) } },
      },
    });
    expect(facts.routes).toEqual([{ nodeId: 'route', routeKey: 'decline' }]);
    expect(facts.conditionSha256).toHaveLength(1);
    expect(facts.conditionSha256[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(facts.codeSha256).toEqual(['a'.repeat(64)]);
  });

  it('keeps the path through a catch-all route, which has no condition to digest (Workflow 8C review R001)', () => {
    const condition = { '>': [{ var: 'vars.risk' }, 5] };
    const withCatchAll = {
      steps: [
        {
          id: 'decide',
          type: 'conditional',
          routes: [
            { key: 'high', label: 'High', condition },
            { key: 'rest', label: 'The rest' },
          ],
        },
      ],
    } as unknown as WorkflowDefinition;
    const facts = routesOf(withCatchAll, { outputs: { '': { decide: { route: 'rest' } } } });
    expect(facts.routes).toEqual([{ nodeId: 'decide', routeKey: 'rest' }]);
    // The condition read before the catch-all was taken is kept; the catch-all reads none.
    const onlyHigh = routesOf(withCatchAll, { outputs: { '': { decide: { route: 'high' } } } });
    expect(facts.conditionSha256).toEqual(onlyHigh.conditionSha256);
    expect(facts.conditionSha256).toHaveLength(1);
  });

  it('keeps an H-tier match with its tier, stage and confidence (H10)', () => {
    const itemId = 'lifc_01M5CK16P0D13FXHZSS4TCFBVH';
    expect(
      runEvidenceOf({
        outputs: {
          '': {
            screen: {
              matches: [
                {
                  'list-item-id': itemId,
                  method: 'fuzzy_name',
                  tier: 'H',
                  stage: 'beta',
                  confidence: 0.9,
                },
              ],
            },
          },
        },
      }),
    ).toEqual([
      {
        kind: 'list-item',
        id: itemId,
        name: 'fuzzy_name',
        status: null,
        tier: 'H',
        stage: 'beta',
        confidence: 0.9,
      },
    ]);
  });
});
