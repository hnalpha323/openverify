/**
 * C243.2 (Phase 11, Workflow 11A Stage 1a (U); verification V09; orchestrator decision 23): the three
 * Connect triggers are `trigger-event` configs over the event names of the common checkpoint, with
 * no declaration of their own: each is triggerable, a workflow's trigger takes it, it maps to its
 * subject, and its payload's filter subject is strict with nothing resolved (a Connect resource
 * links to no template and no account type). The three action keys are reserved, and the API's
 * registry holds `workflow-connect`'s entry for each (it held none, so publish answered
 * `action_unknown`, until they were built).
 */
import { readFileSync } from 'node:fs';
import {
  eventSubject,
  isTriggerableEvent,
  workflowTriggerSchema,
  type EventName,
} from '@openverify/contracts';
import type { Db } from '@openverify/db';
import * as workflowActions from '@openverify/workflow-engine/actions';
import { describe, expect, it } from 'vitest';
import { eventFilterSubjects, toEventSubject } from '../../events/subject.js';
import { WORKFLOW_ACTIONS } from '../definitions/registry.js';

const TRIGGERS: readonly [EventName, string][] = [
  ['connect/share-token.inbound-created', 'connect/share-token'],
  ['consent-record.withdrawn', 'consent-record'],
  ['connect/share-token.consent-withdrawn', 'connect/share-token'],
];

const payloadOf = (name: string): unknown =>
  (
    JSON.parse(
      readFileSync(
        new URL(
          `../../../../../contracts/fixtures/api/connect/event-${name.replace('connect/', '').replace('.', '-')}.json`,
          import.meta.url,
        ),
        'utf8',
      ),
    ) as { data: { attributes: { payload: unknown } } }
  ).data.attributes.payload;

describe('the Connect triggers (C243.2)', () => {
  it.each(TRIGGERS)('%s is triggerable and maps to %s', async (name, subject) => {
    expect(isTriggerableEvent(name)).toBe(true);
    expect(eventSubject(name)).toBe(subject);
    expect(
      workflowTriggerSchema.safeParse({ type: 'trigger-event', config: { events: [name] } })
        .success,
    ).toBe(true);
    const [filter] = await eventFilterSubjects({} as Db, 'env_01M5CJZC30W7PFE0GD30HJWEC5', [
      payloadOf(name),
    ]);
    expect(toEventSubject(filter)).toEqual({ strict: true });
  });
});

const RESERVED_CONNECT_ACTION_KEYS =
  ((workflowActions as Readonly<Record<string, unknown>>).RESERVED_CONNECT_ACTION_KEYS as
    readonly string[] | undefined) ?? [];

describe('the Connect actions, built by workflow-connect (C243.1)', () => {
  it('reserves the three keys and holds version 1 of each', () => {
    expect([...RESERVED_CONNECT_ACTION_KEYS]).toEqual([
      'create_share_token',
      'redeem_share_token',
      'expire_share_token',
    ]);
    for (const key of RESERVED_CONNECT_ACTION_KEYS) {
      expect(WORKFLOW_ACTIONS.latest(key)?.version, key).toBe(1);
    }
  });
});
