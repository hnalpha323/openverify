import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import {
  createdAtClock,
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
  wallClockStepsBack,
} from '../testing.js';
import { createEvent, getEvent, listEvents } from './events.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const payload = (inquiryId: string) => ({
  data: {
    type: 'inquiry',
    id: inquiryId,
    attributes: { status: 'completed', 'name-first': 'Jane' },
  },
});

describe('events', () => {
  it('stores an event with its payload encrypted', async () => {
    const { environment } = await createTestTenant(database.db);
    const inquiryId = testId('inq');

    const event = await createEvent(database.db, environment.id, {
      id: testId('evt'),
      name: 'inquiry.completed',
      payload: payload(inquiryId),
    });
    const raw = await database.db.execute<{ payload: string }>(
      sql`select payload from events where id = ${event.id}`,
    );

    expect(event).toMatchObject({
      environmentId: environment.id,
      name: 'inquiry.completed',
      payload: payload(inquiryId),
    });
    expect(raw.rows[0]?.payload).toMatch(/^ov1\./);
    expect(raw.rows[0]?.payload).not.toContain('Jane');
    expect(await getEvent(database.db, environment.id, event.id)).toEqual(event);
  });

  it('lists events newest first and keeps them inside their environment', async () => {
    onTestFinished(wallClockStepsBack());
    const { environment } = await createTestTenant(database.db);
    const other = await createTestTenant(database.db);
    const clock = createdAtClock(database.db);
    const first = await clock.stamp(
      'events',
      await createEvent(database.db, environment.id, {
        id: testId('evt'),
        name: 'inquiry.created',
        payload: {},
      }),
    );
    const second = await clock.stamp(
      'events',
      await createEvent(database.db, environment.id, {
        id: testId('evt'),
        name: 'inquiry.started',
        payload: {},
      }),
    );

    const page = await listEvents(database.db, environment.id, { size: 1 });

    expect(page.items.map((event) => event.id)).toEqual([second.id]);
    expect(page.next).toBe(second.id);
    expect((await listEvents(database.db, environment.id, { after: second.id })).items).toEqual([
      first,
    ]);
    expect(await getEvent(database.db, other.environment.id, first.id)).toBeNull();
    expect((await listEvents(database.db, other.environment.id)).items).toEqual([]);
  });
});
