/**
 * C151.10 (Workflow 9A, api-flow-engine): the public expiry windows. On `created -> pending` the
 * expiry becomes `started-at + inquiry-expiration-after-start-seconds` when the version sets it (an
 * absent value changes nothing at the start); on a resume it becomes
 * `max(expires-at, now + inquiry-expiration-after-resume-seconds)` (86,400 by default). Every value
 * is synthetic.
 */
import {
  defaultInquiryTemplateAttributes,
  resolveTemplateSettings,
  TEMPLATE_SETTINGS_DEFAULTS,
} from '@openverify/contracts';
import { getInquiry, lockInquiry, type Inquiry } from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import {
  createdInquiryWindows,
  extendExpiryOnResumeInTx,
  oneTimeLinkLifetimeSeconds,
} from './expiry.js';
import { positionFlowInTx } from './position.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const HOUR = 3_600_000;

async function inquiryWith(
  settings: Record<string, unknown>,
  expiresInMs: number,
): Promise<Inquiry> {
  const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, {
    flow: defaultInquiryTemplateAttributes().flow,
  });
  await api.database.db.execute(
    sql`update inquiry_template_versions set settings = ${JSON.stringify(settings)}::jsonb
         where id = ${inquiry.inquiryTemplateVersionId}`,
  );
  const expiresAt = new Date(api.clock.now().getTime() + expiresInMs).toISOString();
  await api.database.db.execute(
    sql`update inquiries set expires_at = ${expiresAt}::timestamptz where id = ${inquiry.id}`,
  );
  return reread(inquiry.id);
}

/**
 * C151.10 (Workflow 9B, api-flow-expiry): the inquiry's own windows, as `POST /inquiries`' `meta`
 * stores them (`null`: its version decides).
 */
async function withOwnWindows(
  inquiry: Inquiry,
  windows: { start?: number; resume?: number },
): Promise<Inquiry> {
  await api.database.db.execute(
    sql`update inquiries
           set expiration_after_start_seconds = ${windows.start ?? null},
               expiration_after_resume_seconds = ${windows.resume ?? null}
         where id = ${inquiry.id}`,
  );
  return reread(inquiry.id);
}

async function reread(inquiryId: string): Promise<Inquiry> {
  const inquiry = await getInquiry(api.database.db, api.environmentId, inquiryId);
  if (inquiry === null) throw new Error('no inquiry');
  return inquiry;
}

const resume = (inquiry: Inquiry) =>
  api.database.db.transaction(async (tx) => {
    await lockInquiry(tx, api.environmentId, inquiry.id);
    return extendExpiryOnResumeInTx(tx, inquiry, api.clock.now());
  });

describe('the expiry on a resume (C151.10)', () => {
  it('moves a nearer expiry to now plus the default day', async () => {
    const inquiry = await inquiryWith({}, HOUR);
    const expected = new Date(api.clock.now().getTime() + 24 * HOUR);
    expect(await resume(inquiry)).toEqual(expected);
    expect((await reread(inquiry.id)).expiresAt).toEqual(expected);
  });

  it('takes the version’s after-resume window, and never shortens a later expiry', async () => {
    const short = await inquiryWith({ 'inquiry-expiration-after-resume-seconds': 7_200 }, HOUR);
    expect(await resume(short)).toEqual(new Date(api.clock.now().getTime() + 2 * HOUR));

    const later = await inquiryWith(
      { 'inquiry-expiration-after-resume-seconds': 7_200 },
      48 * HOUR,
    );
    expect(await resume(later)).toEqual(new Date(api.clock.now().getTime() + 48 * HOUR));
    expect((await reread(later.id)).expiresAt).toEqual(
      new Date(api.clock.now().getTime() + 48 * HOUR),
    );
  });

  it('leaves a decided or redacted inquiry as it is', async () => {
    const decided = await inquiryWith({}, HOUR);
    await api.database.db.execute(
      sql`update inquiries set status = 'completed' where id = ${decided.id}`,
    );
    expect(await resume(await reread(decided.id))).toEqual(decided.expiresAt);

    const redacted = await inquiryWith({}, HOUR);
    await api.database.db.execute(
      sql`update inquiries set redacted_at = now() where id = ${redacted.id}`,
    );
    expect(await resume(await reread(redacted.id))).toEqual(redacted.expiresAt);
  });
});

describe('the expiry on a resume, with the inquiry’s own window (C151.10, Workflow 9B)', () => {
  it('takes the inquiry’s after-resume window over its version’s, for that inquiry only', async () => {
    const settings = { 'inquiry-expiration-after-resume-seconds': 36_000 };
    const own = await withOwnWindows(await inquiryWith(settings, HOUR), { resume: 7_200 });
    expect(await resume(own)).toEqual(new Date(api.clock.now().getTime() + 2 * HOUR));
    expect((await reread(own.id)).expiresAt).toEqual(
      new Date(api.clock.now().getTime() + 2 * HOUR),
    );

    const sibling = await inquiryWith(settings, HOUR);
    expect(await resume(sibling)).toEqual(new Date(api.clock.now().getTime() + 10 * HOUR));
  });

  it('never shortens a later expiry with the inquiry’s own window', async () => {
    const own = await withOwnWindows(await inquiryWith({}, 48 * HOUR), { resume: 7_200 });
    expect(await resume(own)).toEqual(own.expiresAt);
    expect((await reread(own.id)).expiresAt).toEqual(own.expiresAt);
  });

  it('never revives an inquiry already past its expiry, whichever window decides', async () => {
    const overdue = await inquiryWith({}, -HOUR);
    expect(await resume(overdue)).toEqual(overdue.expiresAt);
    expect((await reread(overdue.id)).expiresAt).toEqual(overdue.expiresAt);

    const due = await withOwnWindows(await inquiryWith({}, 0), { resume: 7_200 });
    expect(await resume(due)).toEqual(due.expiresAt);
    expect((await reread(due.id)).expiresAt).toEqual(due.expiresAt);
  });
});

describe('the expiry at the start (C151.10)', () => {
  const start = async (inquiry: Inquiry) => {
    const advance = await api.database.db.transaction(async (tx) => {
      await lockInquiry(tx, api.environmentId, inquiry.id);
      return positionFlowInTx(tx, api.deps, {
        environmentId: api.environmentId,
        inquiryId: inquiry.id,
      });
    });
    await api.deps.events.dispatch(advance.staged);
    return reread(inquiry.id);
  };

  it('becomes started-at plus the after-start window when the version sets it, and stays otherwise', async () => {
    const windowed = await start(
      await inquiryWith({ 'inquiry-expiration-after-start-seconds': 1_800 }, 24 * HOUR),
    );
    expect(windowed.status).toBe('pending');
    expect(windowed.expiresAt).toEqual(
      new Date((windowed.startedAt ?? new Date(0)).getTime() + HOUR / 2),
    );

    const plain = await inquiryWith({}, 24 * HOUR);
    expect((await start(plain)).expiresAt).toEqual(plain.expiresAt);
  });

  it('takes the inquiry’s own after-start window over its version’s, or where the version has none', async () => {
    const over = await start(
      await withOwnWindows(
        await inquiryWith({ 'inquiry-expiration-after-start-seconds': 1_800 }, 24 * HOUR),
        { start: 7_200 },
      ),
    );
    expect(over.expiresAt).toEqual(new Date((over.startedAt ?? new Date(0)).getTime() + 2 * HOUR));

    const alone = await start(
      await withOwnWindows(await inquiryWith({}, 24 * HOUR), { start: 900 }),
    );
    expect(alone.expiresAt).toEqual(
      new Date((alone.startedAt ?? new Date(0)).getTime() + HOUR / 4),
    );
  });

  it('never revives an inquiry already past its expiry when it starts', async () => {
    const overdue = await withOwnWindows(
      await inquiryWith({ 'inquiry-expiration-after-start-seconds': 1_800 }, -HOUR),
      { start: 7_200 },
    );
    const started = await start(overdue);
    expect(started.status).toBe('pending');
    expect(started.expiresAt).toEqual(overdue.expiresAt);
  });
});

describe('the windows `POST /inquiries` stores (C151.10, Workflow 9B)', () => {
  const settings = resolveTemplateSettings({ 'inquiry-expiration-seconds': 600 });

  it('takes the creation window from meta, else the version’s, and keeps the other three', () => {
    expect(
      createdInquiryWindows(
        {
          'expiration-after-create-interval-seconds': 3_600,
          'expiration-after-start-interval-seconds': 1_800,
          'expiration-after-resume-interval-seconds': 7_200,
          'one-time-link-expiration-seconds': 900,
        },
        settings,
      ),
    ).toEqual({
      expiresInSeconds: 3_600,
      expirationAfterStartSeconds: 1_800,
      expirationAfterResumeSeconds: 7_200,
      oneTimeLinkExpirationSeconds: 900,
    });
    expect(createdInquiryWindows({}, settings)).toEqual({
      expiresInSeconds: 600,
      expirationAfterStartSeconds: null,
      expirationAfterResumeSeconds: null,
      oneTimeLinkExpirationSeconds: null,
    });
  });
});

describe('a one-time link’s lifetime (C151.10, Workflow 9B)', () => {
  const settings = resolveTemplateSettings({ 'one-time-link-expiration-seconds': 1_200 });

  it('is the requested lifetime, else the inquiry’s own window, else the version’s', () => {
    expect(oneTimeLinkLifetimeSeconds({ oneTimeLinkExpirationSeconds: 900 }, settings, 600)).toBe(
      600,
    );
    expect(
      oneTimeLinkLifetimeSeconds({ oneTimeLinkExpirationSeconds: 900 }, settings, undefined),
    ).toBe(900);
    expect(
      oneTimeLinkLifetimeSeconds({ oneTimeLinkExpirationSeconds: null }, settings, undefined),
    ).toBe(1_200);
    expect(
      oneTimeLinkLifetimeSeconds(
        { oneTimeLinkExpirationSeconds: null },
        TEMPLATE_SETTINGS_DEFAULTS,
        undefined,
      ),
    ).toBe(86_400);
  });
});
