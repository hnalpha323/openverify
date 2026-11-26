/**
 * C239.2 (Workflow 11A Stage 1a): a connection, a share token and a consent record link to no
 * template and no account type. Their filter subject is strict with nothing resolved, so none of
 * them reaches a webhook filtered on a template or an account type.
 */
import { readFileSync } from 'node:fs';
import { EVENT_NAMES } from '@openverify/contracts';
import type { Db } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import { eventFilterSubjects, toEventSubject } from './subject.js';

const CONNECT_EVENTS = (EVENT_NAMES as readonly string[]).filter(
  (name) => name.startsWith('connect/') || name.startsWith('consent-record.'),
);

const sample = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../../contracts/fixtures/api/connect/event-${name.replace('connect/', '').replace('.', '-')}.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { data: { attributes: { payload: unknown } } };

describe('the Connect subjects (C239.2)', () => {
  it('covers the sixteen Connect events', () => {
    expect(CONNECT_EVENTS).toHaveLength(16);
  });

  it.each(CONNECT_EVENTS)('%s is strict, with nothing resolved', async (name) => {
    const payload = sample(name).data.attributes.payload;
    // No row is read for these subjects, so no database is needed.
    const [subject] = await eventFilterSubjects({} as Db, 'env_01M5CJZC30W7PFE0GD30HJWEC5', [
      payload,
    ]);
    expect(subject).toEqual({ strict: true });
    expect(toEventSubject(subject)).toEqual({ strict: true });
  });
});
