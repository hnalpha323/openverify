/**
 * C55 through the flow API: `POST /verifications/:id/otp` validates the destination, waits out
 * the cooldowns, counts the fail-closed limits, stores one open code (its HMAC only) superseding
 * the earlier one, sends it (SMS through the bound sender, email through the mailer) and records
 * the delivery or its failure; `POST .../otp/confirm` reserves an attempt before the compare,
 * confirms a match and counts a wrong code. No dead end: a request with no send and no code left
 * submits the verification. The code is never in a response, problem or event.
 * Every number, address and name is synthetic.
 */
import {
  OTP_MAX_SENDS,
  OTP_SMS_BUDGET_TRIPPED_AUDIT_ACTION,
  flowVerificationDocumentSchema,
} from '@openverify/contracts';
import {
  createKeyring,
  getOtpChallenge,
  getOtpVerificationState,
  getVerification,
  listAuditLogs,
  listOtpChallenges,
  openOtpChallengeDestination,
  otpDestinationIndex,
} from '@openverify/db';
import { seedOtpChallenge, seedOtpVerificationState } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SmsSendError } from '../../ports.js';
import {
  bearer,
  createInquiry,
  createTestApi,
  FLOW_PUBLIC_URL,
  resumeInquiry,
  type TestApi,
} from '../../test-support/harness.js';
import {
  TEST_ADDRESS,
  TEST_CANADIAN_NUMBER,
  TEST_NUMBER,
  confirmCode,
  controllableLimiter,
  createOtpTemplate,
  mailedCode,
  otpOverrides,
  otpTarget,
  otpTemplateAttributes,
  recordingSmsSender,
  sendCode,
  wrongCode,
  type ControllableLimiter,
  unpublishedOtpTarget,
  type RecordingSmsSender,
} from '../../services/otp/testing.js';

let api: TestApi;
let sms: RecordingSmsSender;
let limiter: ControllableLimiter;
let templateId: string;

beforeAll(async () => {
  limiter = controllableLimiter();
  api = await createTestApi(
    otpOverrides({
      sms: (defaults) => {
        sms = recordingSmsSender(defaults.cache, defaults.clock);
        return sms;
      },
      limiter,
    }),
  );
  templateId = await createOtpTemplate(api);
});

afterAll(async () => {
  await api.close();
});

const phone = (number = TEST_NUMBER) => ({ 'phone-number': number });
const email = (address = TEST_ADDRESS) => ({ 'email-address': address });

/** The latest SMS code sent. */
function smsCode(): string {
  const code = sms.sends.at(-1)?.context.code;
  if (code === undefined) {
    throw new Error('no code was sent');
  }
  return code;
}

function reset() {
  limiter.refusing.clear();
  limiter.down = false;
}

function guidance(response: { json(): unknown }) {
  const document = flowVerificationDocumentSchema.parse(response.json());
  return (document.data.attributes as { guidance?: { otp?: unknown } | null }).guidance;
}

describe('POST .../otp: sending a code (C55.6, C55.8-C55.10)', () => {
  it('sends a six-digit code by SMS, stores only its HMAC, and answers the open code without it', async () => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'phone_number');
    const now = api.clock.now();

    const response = await sendCode(api, token, verificationId, phone('+1 (202) 555-0100'));

    expect(response.statusCode).toBe(200);
    expect(guidance(response)).toEqual({
      'allowed-countries': ['US', 'CA'],
      'code-length': 6,
      otp: {
        'masked-destination': '+1 ••• ••• 0100',
        'expires-at': new Date(now.getTime() + 600_000).toISOString(),
        'resend-available-at': new Date(now.getTime() + 30_000).toISOString(),
        'sends-remaining': OTP_MAX_SENDS - 1,
        'attempts-remaining': 5,
      },
    });
    const code = smsCode();
    expect(code).toMatch(/^[0-9]{6}$/u);
    expect(response.body).not.toContain(code);
    expect(sms.sends.at(-1)?.message.to).toBe(TEST_NUMBER);
    const [challenge] = await listOtpChallenges(api.database.db, api.environmentId, verificationId);
    expect(challenge).toMatchObject({ channel: 'sms', status: 'sent', provider: 'sandbox' });
    expect(
      await openOtpChallengeDestination(api.database.db, api.environmentId, challenge?.id ?? ''),
    ).toBe(TEST_NUMBER);
    expect(
      await getOtpVerificationState(api.database.db, api.environmentId, verificationId),
    ).toMatchObject({ sends: 1, wrongEntries: 0, limitedAt: null });
  });

  it('writes the SMS with the organization and the configured flow host, never the request host', async () => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'phone_number');

    await sendCode(api, token, verificationId, phone(), {
      host: 'phish.example',
      origin: 'https://phish.example',
    });

    const body = sms.sends.at(-1)?.message.body ?? '';
    const host = new URL(FLOW_PUBLIC_URL).host;
    expect(body).toBe(
      `${body.split(': ')[0] ?? ''}: ${smsCode()} is your verification code. Do not share it.\n\n@${host} #${smsCode()}`,
    );
    expect(body).not.toContain('phish');
  });

  it('writes it in Spanish for a Spanish consent', async () => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'phone_number', {
      locale: 'es',
    });

    await sendCode(api, token, verificationId, phone(TEST_CANADIAN_NUMBER));

    expect(sms.sends.at(-1)?.message.body).toContain(`${smsCode()} es tu código de verificación.`);
  });

  it('mails an email code to the validated address, as an address object, in plain text', async () => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'email_address');

    const response = await sendCode(
      api,
      token,
      verificationId,
      email(' Avery.Synthetic@Mail.Example.test '),
    );

    expect(response.statusCode).toBe(200);
    const message = api.mailer.messages.at(-1);
    expect(message?.to).toEqual({ address: 'Avery.Synthetic@mail.example.test' });
    expect(message?.subject).toMatch(/verification code$/u);
    expect(message?.html).toBeUndefined();
    expect(message?.text).toContain(mailedCode(api));
    expect(guidance(response)).toMatchObject({
      'code-length': 6,
      otp: { 'masked-destination': 'A•••@mail.example.test', 'attempts-remaining': 5 },
    });
    expect(response.body).not.toContain(mailedCode(api));
  });

  it('mails the code from the environment’s mail-sender-name (C169.8, K9-25)', async () => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'email_address');
    await api.database.db.execute(sql`update environments
      set settings = settings || '{"mail-sender-name": "Synthetic Bank"}'::jsonb
      where id = ${api.environmentId}`);

    try {
      const response = await sendCode(api, token, verificationId, email());
      expect(response.statusCode).toBe(200);
    } finally {
      await api.database.db.execute(sql`update environments
        set settings = settings - 'mail-sender-name' where id = ${api.environmentId}`);
    }

    expect(api.mailer.messages.at(-1)?.senderName).toBe('Synthetic Bank');
  });

  it.each([
    [phone('+1 202 555 01'), 'otp_destination_invalid'],
    [phone('2025550100'), 'otp_destination_invalid'],
    [phone('+33 6 12 34 56 78'), 'otp_destination_not_allowed'],
    [phone('+1 800 555 0100'), 'otp_destination_not_allowed'],
  ])('refuses %j with %s, sending nothing', async (body, code) => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'phone_number');
    const before = sms.sends.length;

    // The problem's request id is the client's, or a random UUID, which can spell 202 too.
    const response = await sendCode(api, token, verificationId, body, {
      'x-request-id': 'trace-202-from-the-edge',
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code });
    const problem = response.json<Record<string, unknown>>();
    expect(JSON.stringify({ ...problem, requestId: undefined })).not.toContain('202');
    expect(sms.sends).toHaveLength(before);
  });

  it.each([
    '<"a@evil.example>"@good.example',
    '"a@evil.example"@good.example',
    'a@good.example,b@evil.example',
    'avery@example',
    'avery@[203.0.113.7]',
  ])('refuses the address %s before the mailer sees it', async (address) => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'email_address');
    const before = api.mailer.messages.length;

    const response = await sendCode(api, token, verificationId, email(address));

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'otp_destination_invalid' });
    expect(api.mailer.messages).toHaveLength(before);
  });

  it('takes only the member of its own channel (422)', async () => {
    reset();
    const phoneTarget = await otpTarget(api, templateId, 'phone_number');
    const emailTarget = await otpTarget(api, templateId, 'email_address');

    expect(
      (await sendCode(api, phoneTarget.token, phoneTarget.verificationId, email())).statusCode,
    ).toBe(422);
    expect(
      (await sendCode(api, emailTarget.token, emailTarget.verificationId, phone())).statusCode,
    ).toBe(422);
  });

  it('waits out the cooldown, then supersedes the open code (C55.4, C55.6)', async () => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'phone_number');
    await sendCode(api, token, verificationId, phone());
    const first = smsCode();
    const resendAt = new Date(api.clock.now().getTime() + 30_000).toISOString();

    const early = await sendCode(api, token, verificationId, phone());
    api.clock.advance(30_000);
    const later = await sendCode(api, token, verificationId, phone(TEST_CANADIAN_NUMBER));

    expect(early.statusCode).toBe(429);
    expect(early.json()).toMatchObject({
      code: 'otp_resend_too_soon',
      'resend-available-at': resendAt,
    });
    expect(later.statusCode).toBe(200);
    const challenges = await listOtpChallenges(api.database.db, api.environmentId, verificationId);
    expect(challenges.map((challenge) => challenge.status)).toEqual(['sent', 'superseded']);
    expect((await confirmCode(api, token, verificationId, first)).json()).toMatchObject({
      code: 'otp_incorrect',
    });
  });

  it('a failed delivery answers 502, counts no send and allows an immediate retry', async () => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'phone_number');
    sms.failNext(new SmsSendError('twilio_rejected', { retryable: false }));

    const failed = await sendCode(api, token, verificationId, phone());
    const retried = await sendCode(api, token, verificationId, phone());

    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toMatchObject({ code: 'otp_delivery_failed' });
    expect(failed.body).not.toContain('2025550100');
    expect(retried.statusCode).toBe(200);
    const challenges = await listOtpChallenges(api.database.db, api.environmentId, verificationId);
    expect(challenges.map((challenge) => [challenge.status, challenge.errorCode])).toEqual([
      ['sent', null],
      ['errored', 'twilio_rejected'],
    ]);
    expect(
      (await getOtpVerificationState(api.database.db, api.environmentId, verificationId))?.sends,
    ).toBe(1);
  });

  it('a send after the fifth submits the verification (no dead end, C55.6)', async () => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'phone_number');
    for (let send = 0; send < OTP_MAX_SENDS; send += 1) {
      expect((await sendCode(api, token, verificationId, phone())).statusCode).toBe(200);
      api.clock.advance(240_000);
    }
    const queued = api.queue.jobs.length;

    const response = await sendCode(api, token, verificationId, phone());

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'otp_not_confirmed' });
    expect(
      (await getVerification(api.database.db, api.environmentId, verificationId))?.status,
    ).toBe('submitted');
    expect(api.queue.jobs.slice(queued)).toEqual([
      { environmentId: api.environmentId, verificationId },
    ]);
    expect(
      api.events.events.some(
        (event) =>
          event.name === 'verification.submitted' &&
          JSON.stringify(event.payload).includes(verificationId),
      ),
    ).toBe(true);
    expect(
      (await listOtpChallenges(api.database.db, api.environmentId, verificationId)).filter(
        (challenge) => challenge.status === 'sent',
      ),
    ).toEqual([]);
  });

  it.each([
    ['otp-destination-hour', 'destination'],
    ['otp-destination-day', 'destination'],
    ['otp-inquiry-day', 'inquiry'],
    ['otp-sms-prefix-hour', 'destination'],
  ] as const)(
    'a %s refusal answers 429 with Retry-After and is recorded as %s',
    async (rule, reason) => {
      reset();
      const { verificationId, token } = await otpTarget(api, templateId, 'phone_number');
      limiter.refusing.add(rule);

      const response = await sendCode(api, token, verificationId, phone());

      expect(response.statusCode).toBe(429);
      expect(response.headers['retry-after']).toBe('75');
      expect(response.json()).toMatchObject({ code: 'otp_rate_limited' });
      expect(
        await getOtpVerificationState(api.database.db, api.environmentId, verificationId),
      ).toMatchObject({ limitedReason: reason, sends: 0 });
      expect(await listOtpChallenges(api.database.db, api.environmentId, verificationId)).toEqual(
        [],
      );
    },
  );

  it('a per-address refusal answers 429 and is not recorded (C55.7)', async () => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'phone_number');
    limiter.refusing.add('otp-ip-hour');

    const response = await sendCode(api, token, verificationId, phone());

    expect(response.statusCode).toBe(429);
    expect(
      await getOtpVerificationState(api.database.db, api.environmentId, verificationId),
    ).toBeNull();
  });

  it('fails closed with 503 while the limit store is down, recorded as store_unavailable', async () => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'email_address');
    limiter.down = true;

    const response = await sendCode(api, token, verificationId, email());

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'otp_rate_limited' });
    expect(
      await getOtpVerificationState(api.database.db, api.environmentId, verificationId),
    ).toMatchObject({ limitedReason: 'store_unavailable' });
  });

  it('records the environment budget trip once an hour (C55.7)', async () => {
    reset();
    const before = (await budgetTrips()).length;
    limiter.refusing.add(`otp-sms-max-per-hour|${api.environmentId}|budget`);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { verificationId, token } = await otpTarget(api, templateId, 'phone_number');
      const response = await sendCode(api, token, verificationId, phone());
      expect(response.statusCode).toBe(429);
      expect(
        await getOtpVerificationState(api.database.db, api.environmentId, verificationId),
      ).toMatchObject({ limitedReason: 'environment' });
    }

    const entries = await budgetTrips();
    expect(entries.length - before).toBe(1);
    expect(entries[0]).toMatchObject({ actorType: 'system', resourceId: api.environmentId });
    expect(JSON.stringify(entries[0]?.metadata)).not.toContain('2025550100');
  });

  it('answers 409 otp_already_confirmed once the code was confirmed', async () => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'phone_number');
    await sendCode(api, token, verificationId, phone());
    expectConfirmed(await confirmCode(api, token, verificationId, smsCode()));

    const send = await sendCode(api, token, verificationId, phone());
    const confirm = await confirmCode(api, token, verificationId, smsCode());

    expect(send.statusCode).toBe(409);
    expect(send.json()).toMatchObject({ code: 'otp_already_confirmed' });
    expect(confirm.json()).toMatchObject({ code: 'otp_already_confirmed' });
  });
});

/** The environment's budget trip entries, newest first. */
async function budgetTrips() {
  return (
    await listAuditLogs(api.database.db, api.environmentId, {
      resourceType: 'environment',
      resourceId: api.environmentId,
    })
  ).filter((entry) => entry.action === OTP_SMS_BUDGET_TRIPPED_AUDIT_ACTION);
}

function expectConfirmed(response: { statusCode: number; json(): unknown }) {
  expect(response.statusCode).toBe(200);
  expect(flowVerificationDocumentSchema.parse(response.json()).data.attributes.status).toBe(
    'confirmed',
  );
}

describe('POST .../otp/confirm: entering the code (C55.3-C55.5)', () => {
  it('confirms the right code, which leaves no code HMAC and counts no wrong entry', async () => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'email_address');
    await sendCode(api, token, verificationId, email());

    expectConfirmed(await confirmCode(api, token, verificationId, mailedCode(api)));

    const [challenge] = await listOtpChallenges(api.database.db, api.environmentId, verificationId);
    expect(challenge).toMatchObject({
      status: 'confirmed',
      failedAttempts: 0,
      confirmedAt: api.clock.now(),
    });
    expect(
      await getOtpVerificationState(api.database.db, api.environmentId, verificationId),
    ).toMatchObject({ wrongEntries: 0 });
    expect(
      (await getVerification(api.database.db, api.environmentId, verificationId))?.status,
    ).toBe('confirmed');
  });

  it('counts a wrong code before the compare and answers attempts-remaining', async () => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'phone_number');
    await sendCode(api, token, verificationId, phone());

    const response = await confirmCode(api, token, verificationId, wrongCode(smsCode()));

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'otp_incorrect', 'attempts-remaining': 4 });
    expect(response.body).not.toContain(smsCode());
    const [challenge] = await listOtpChallenges(api.database.db, api.environmentId, verificationId);
    expect(challenge?.failedAttempts).toBe(1);
    expect(
      (await getOtpVerificationState(api.database.db, api.environmentId, verificationId))
        ?.wrongEntries,
    ).toBe(1);
    expect(limiter.calls.at(-1)?.rule.name).toBe('otp-destination-guess-day');
  });

  it('exhausts a code after five wrong tries', async () => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'phone_number');
    await sendCode(api, token, verificationId, phone());
    const wrong = wrongCode(smsCode());

    const remaining: unknown[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      remaining.push(
        (await confirmCode(api, token, verificationId, wrong)).json<Record<string, unknown>>()[
          'attempts-remaining'
        ],
      );
    }
    const sixth = await confirmCode(api, token, verificationId, smsCode());

    expect(remaining).toEqual([4, 3, 2, 1, 0]);
    expect(sixth.statusCode).toBe(409);
    expect(sixth.json()).toMatchObject({ code: 'otp_code_exhausted' });
  });

  it('answers otp_expired after ten minutes and closes the code', async () => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'phone_number');
    await sendCode(api, token, verificationId, phone());
    const code = smsCode();
    api.clock.advance(600_000);

    const response = await confirmCode(api, token, verificationId, code);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'otp_expired' });
    const [challenge] = await listOtpChallenges(api.database.db, api.environmentId, verificationId);
    expect(challenge?.status).toBe('expired');
  });

  it('answers otp_not_sent before any code', async () => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'phone_number');

    const response = await confirmCode(api, token, verificationId, '123456');

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'otp_not_sent' });
  });

  it('reads a code whose key left the keyring as expired (C55.3)', async () => {
    reset();
    const { inquiryId, verificationId, token } = await otpTarget(api, templateId, 'phone_number');
    const gone = createKeyring(new Uint8Array(32).fill(0x2a)).currentKeyId;
    const challengeId = await seedOtpChallenge(api.database.db, api.environmentId, {
      verificationId,
      inquiryId,
      channel: 'sms',
      destination: TEST_NUMBER,
      // As every stored code has: the blind index of its destination.
      destinationIndex: otpDestinationIndex(api.deps.blindIndexKey, {
        environmentId: api.environmentId,
        channel: 'sms',
        destination: TEST_NUMBER,
      }),
      codeKeyId: gone,
      sentAt: api.clock.now(),
    });
    await seedOtpVerificationState(api.database.db, api.environmentId, {
      verificationId,
      inquiryId,
      sends: 1,
    });

    const response = await confirmCode(api, token, verificationId, '123456');

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'otp_expired' });
    expect((await getOtpChallenge(api.database.db, api.environmentId, challengeId))?.status).toBe(
      'expired',
    );
  });

  it('submits the verification at the tenth wrong entry across codes (C55.5)', async () => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'phone_number');
    await sendCode(api, token, verificationId, phone());
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await confirmCode(api, token, verificationId, wrongCode(smsCode()));
    }
    api.clock.advance(30_000);
    await sendCode(api, token, verificationId, phone());
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await confirmCode(api, token, verificationId, wrongCode(smsCode()))).statusCode).toBe(
        422,
      );
    }

    const tenth = await confirmCode(api, token, verificationId, wrongCode(smsCode()));

    expect(tenth.statusCode).toBe(409);
    expect(tenth.json()).toMatchObject({ code: 'otp_attempts_exhausted' });
    expect(
      (await getVerification(api.database.db, api.environmentId, verificationId))?.status,
    ).toBe('submitted');
    expect(
      await getOtpVerificationState(api.database.db, api.environmentId, verificationId),
    ).toMatchObject({ wrongEntries: 10 });
  });

  it('submits a verification whose sends are used and whose last code expired (C55.6)', async () => {
    reset();
    const { inquiryId, verificationId, token } = await otpTarget(api, templateId, 'phone_number');
    await seedOtpChallenge(api.database.db, api.environmentId, {
      verificationId,
      inquiryId,
      channel: 'sms',
      destination: TEST_NUMBER,
      status: 'expired',
      sentAt: api.clock.now(),
    });
    await seedOtpVerificationState(api.database.db, api.environmentId, {
      verificationId,
      inquiryId,
      sends: OTP_MAX_SENDS,
    });

    const response = await confirmCode(api, token, verificationId, '123456');

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'otp_not_confirmed' });
    expect(
      (await getVerification(api.database.db, api.environmentId, verificationId))?.status,
    ).toBe('submitted');
  });

  it('once the destination guess budget trips, confirms and sends to it answer 429 (C55.5)', async () => {
    reset();
    // A number of its own: the trip marks it for every later send and confirm.
    const guessed = '+12025550142';
    const { verificationId, token } = await otpTarget(api, templateId, 'phone_number');
    await sendCode(api, token, verificationId, phone(guessed));
    limiter.refusing.add('otp-destination-guess-day');

    const tripped = await confirmCode(api, token, verificationId, wrongCode(smsCode()));
    limiter.refusing.clear();
    const confirm = await confirmCode(api, token, verificationId, smsCode());
    api.clock.advance(30_000);
    const send = await sendCode(api, token, verificationId, phone(guessed));
    const other = await otpTarget(api, templateId, 'phone_number');
    const elsewhere = await sendCode(
      api,
      other.token,
      other.verificationId,
      phone(TEST_CANADIAN_NUMBER),
    );

    expect(tripped.statusCode).toBe(429);
    expect(tripped.json()).toMatchObject({ code: 'otp_rate_limited' });
    expect(confirm.statusCode).toBe(429);
    expect(send.statusCode).toBe(429);
    expect(elsewhere.statusCode).toBe(200);
    expect(
      await getOtpVerificationState(api.database.db, api.environmentId, verificationId),
    ).toMatchObject({ limitedReason: 'guess' });
  });

  it('fails closed with 503 while the guess store is down', async () => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'phone_number');
    await sendCode(api, token, verificationId, phone());
    api.cache.failNext(new Error('Valkey is unavailable (reconnecting)'));

    const response = await confirmCode(api, token, verificationId, smsCode());

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'otp_rate_limited' });
    expect(
      await getOtpVerificationState(api.database.db, api.environmentId, verificationId),
    ).toMatchObject({ limitedReason: 'store_unavailable' });
  });
});

describe('the channel guard at send time (C55.10)', () => {
  it('refuses a phone code without an SMS sender, and an email code without a mailer', async () => {
    // Workflow 5C review K9: the harness binds the sandbox sender by default; this one has none.
    const unbound = await createTestApi((defaults) => ({
      providers: { sandbox: {}, production: {} },
      mailer: { ...defaults.mailer, configured: false },
      rateLimiter: controllableLimiter(),
    }));
    try {
      const phoneTarget = await unpublishedOtpTarget(unbound, 'phone_number');
      const emailTarget = await unpublishedOtpTarget(unbound, 'email_address');

      const phoneSend = await sendCode(
        unbound,
        phoneTarget.token,
        phoneTarget.verificationId,
        phone(),
      );
      const emailSend = await sendCode(
        unbound,
        emailTarget.token,
        emailTarget.verificationId,
        email(),
      );

      expect(phoneSend.statusCode).toBe(422);
      expect(phoneSend.json()).toMatchObject({ code: 'otp_channel_not_configured' });
      expect(emailSend.statusCode).toBe(422);
      expect(emailSend.json()).toMatchObject({ code: 'otp_channel_not_configured' });
      expect(unbound.mailer.messages).toEqual([]);
    } finally {
      await unbound.close();
    }
  });
});

describe('the flow view of a phone or email verification (C52.2)', () => {
  it('guides the step before any code, with no open code', async () => {
    reset();
    const phoneTarget = await otpTarget(api, templateId, 'phone_number');
    const emailTarget = await otpTarget(api, templateId, 'email_address');
    const view = (token: string, id: string) =>
      api.app.inject({ url: `/api/v1/flow/verifications/${id}`, headers: bearer(token) });

    expect(guidance(await view(phoneTarget.token, phoneTarget.verificationId))).toEqual({
      'allowed-countries': ['US', 'CA'],
      'code-length': 6,
      otp: null,
    });
    expect(guidance(await view(emailTarget.token, emailTarget.verificationId))).toEqual({
      'code-length': 6,
      otp: null,
    });
  });

  it('sends codes of the length the step sets', async () => {
    reset();
    const longer = await createOtpTemplate(api, [
      { id: 'phone', type: 'phone_otp', allowedCountries: ['US'], codeLength: 8 },
      { id: 'email', type: 'email_otp', codeLength: 10 },
    ]);
    const phoneTarget = await otpTarget(api, longer, 'phone_number');
    const emailTarget = await otpTarget(api, longer, 'email_address');

    const sent = await sendCode(api, phoneTarget.token, phoneTarget.verificationId, phone());
    await sendCode(api, emailTarget.token, emailTarget.verificationId, email());

    expect(guidance(sent)).toMatchObject({ 'code-length': 8 });
    expect(smsCode()).toMatch(/^[0-9]{8}$/u);
    expect(mailedCode(api)).toMatch(/^[0-9]{10}$/u);
    expectConfirmed(
      await confirmCode(api, phoneTarget.token, phoneTarget.verificationId, smsCode()),
    );
  });
});

describe('creating a phone or email verification (C54.1)', () => {
  it.each(['phone-number', 'email-address'] as const)(
    'creates a %s verification, its job being built',
    async (type) => {
      const inquiryId = await createInquiry(api, { templateId });
      const token = await resumeInquiry(api, inquiryId);

      const response = await api.app.inject({
        method: 'POST',
        url: '/api/v1/flow/verifications',
        headers: bearer(token),
        payload: { type },
      });

      expect(response.statusCode).toBe(201);
      expect(flowVerificationDocumentSchema.parse(response.json()).data).toMatchObject({
        type: `verification/${type}`,
        attributes: { status: 'initiated' },
      });
    },
  );
});

describe('delivery through a real sender and the mailer (C55.6, C55.10)', () => {
  it('gives a real sender the message only and records its message id', async () => {
    const sent: unknown[][] = [];
    const real = await createTestApi(
      otpOverrides({
        sms: () => ({
          id: 'twilio',
          sandbox: false,
          send: (...args: unknown[]) => {
            sent.push(args);
            return Promise.resolve({ providerMessageId: `SM${'b'.repeat(32)}` });
          },
        }),
      }),
    );
    try {
      const template = await createOtpTemplate(real);
      const { verificationId, token } = await otpTarget(real, template, 'phone_number');

      expect((await sendCode(real, token, verificationId, phone())).statusCode).toBe(200);

      expect(sent).toHaveLength(1);
      expect(sent[0]).toEqual([
        {
          to: TEST_NUMBER,
          body: expect.stringContaining(' is your verification code.') as unknown,
        },
      ]);
      const [challenge] = await listOtpChallenges(
        real.database.db,
        real.environmentId,
        verificationId,
      );
      expect(challenge).toMatchObject({
        provider: 'twilio',
        providerMessageId: `SM${'b'.repeat(32)}`,
      });
    } finally {
      await real.close();
    }
  });

  it('a mail failure answers 502 and counts no send', async () => {
    reset();
    const { verificationId, token } = await otpTarget(api, templateId, 'email_address');
    api.mailer.failNext(new Error('SMTP connection refused'));

    const response = await sendCode(api, token, verificationId, email());

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ code: 'otp_delivery_failed' });
    const [challenge] = await listOtpChallenges(api.database.db, api.environmentId, verificationId);
    expect(challenge).toMatchObject({ status: 'errored', errorCode: 'mail_failed' });
    expect(
      (await getOtpVerificationState(api.database.db, api.environmentId, verificationId))?.sends,
    ).toBe(0);
  });

  it('refuses a verification whose flow has no step of its type (422)', async () => {
    reset();
    const emailOnly = otpTemplateAttributes([{ id: 'email', type: 'email_otp' }]);
    delete emailOnly['verification-config']['phone-number'];
    const { verificationId, token } = await unpublishedOtpTarget(
      api,
      'phone_number',
      {},
      emailOnly,
    );

    const response = await sendCode(api, token, verificationId, phone());

    expect(response.statusCode).toBe(422);
    expect(response.json<{ detail: string }>().detail).toBe('The flow has no phone-number step.');
  });
});
