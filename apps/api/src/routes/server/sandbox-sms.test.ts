/**
 * C55.11: the sandbox SMS sink answers a `sandbox:read` key with the codes the sandbox sender kept
 * for one number of its environment, newest first, whatever way the number is written; another
 * number or environment gets none; the stored API log redacts each `code`. Every number is
 * synthetic.
 */
import { REDACTED_VALUE, sandboxSmsSearchResponseSchema } from '@openverify/contracts';
import { listApiLogs } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TEST_CANADIAN_NUMBER,
  TEST_NUMBER,
  createOtpTemplate,
  otpOverrides,
  otpTarget,
  sendCode,
} from '../../services/otp/testing.js';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';

const SINK = '/api/v1/sandbox/sms-messages/search';

let api: TestApi;
let templateId: string;

beforeAll(async () => {
  api = await createTestApi(otpOverrides());
  templateId = await createOtpTemplate(api);
});

afterAll(async () => {
  await api.close();
});

function search(token: string, number: string, headers: Record<string, string> = {}) {
  return api.app.inject({
    method: 'POST',
    url: SINK,
    headers: { ...bearer(token), ...headers },
    payload: { 'phone-number': number },
  });
}

async function sendTo(number: string) {
  const { verificationId, token } = await otpTarget(api, templateId, 'phone_number');
  const response = await sendCode(api, token, verificationId, { 'phone-number': number });
  expect(response.statusCode).toBe(200);
}

describe('POST /sandbox/sms-messages/search (C55.11)', () => {
  it('answers the codes kept for the number, newest first', async () => {
    await sendTo(TEST_NUMBER);
    const first = api.clock.now().toISOString();
    api.clock.advance(1_000);
    await sendTo(TEST_NUMBER);
    await sendTo(TEST_CANADIAN_NUMBER);

    const response = await search(api.token, TEST_NUMBER);

    expect(response.statusCode).toBe(200);
    const body = sandboxSmsSearchResponseSchema.parse(response.json());
    expect(body.data).toHaveLength(2);
    expect(body.data.map((entry) => entry['sent-at'])).toEqual([
      api.clock.now().toISOString(),
      first,
    ]);
    expect(body.data.every((entry) => /^[0-9]{6}$/u.test(entry.code))).toBe(true);
  });

  it('reads the number however it is written, and answers none for another', async () => {
    const written = await search(api.token, '+1 (202) 555-0100');
    const unknown = await search(api.token, '+12025550188');
    const garbled = await search(api.token, 'not a number');

    expect(sandboxSmsSearchResponseSchema.parse(written.json()).data.length).toBeGreaterThan(0);
    expect(unknown.json()).toEqual({ data: [] });
    expect(garbled.json()).toEqual({ data: [] });
  });

  it('answers none to another sandbox environment', async () => {
    const other = await api.newTenant();

    expect((await search(other.token, TEST_NUMBER)).json()).toEqual({ data: [] });
  });

  it('keeps no code in the stored API log', async () => {
    const requestId = 'req-sandbox-sink-log';
    await search(api.token, TEST_NUMBER, { 'x-request-id': requestId });

    const logs = await listApiLogs(api.database.db, api.environmentId, { size: 100 });
    const log = logs.items.find((entry) => entry.requestId === requestId);
    const body = JSON.stringify(log?.responseBody);
    expect(body).toContain(REDACTED_VALUE);
    expect(body).not.toMatch(/"code":"[0-9]{6}"/u);
  });
});
