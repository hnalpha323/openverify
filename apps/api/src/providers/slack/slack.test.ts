/**
 * C126.3, C126.5: the incoming-webhook adapter, through the real policy client. Every URL is a fake on
 * hooks.slack.com answered by MockAgent, so nothing leaves the process.
 */
import { MockAgent } from 'undici';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createOutboundHttp, type OutboundHttp } from '../../http/index.js';
import { SlackSendError, type SlackSender } from '../../ports.js';
import { createSlackSender } from './index.js';

const URL_PATH = '/services/T000/B000/changeme';
const URL = `https://hooks.slack.com${URL_PATH}`;
let mock: MockAgent;
let http: OutboundHttp;
let sender: SlackSender;
const bodies: unknown[] = [];

beforeAll(() => {
  mock = new MockAgent();
  mock.disableNetConnect();
  http = createOutboundHttp({ testDispatcher: mock });
  sender = createSlackSender('incoming-webhook', { outboundHttp: http }) as SlackSender;
});

beforeEach(() => {
  bodies.length = 0;
});

afterAll(async () => {
  await http.close();
  await mock.close();
});

const reply = (status: number, body: string, headers: Record<string, string> = {}) => {
  mock
    .get('https://hooks.slack.com')
    .intercept({
      method: 'POST',
      path: URL_PATH,
      body: (text: string) => {
        bodies.push(JSON.parse(text));
        return true;
      },
    })
    .reply(status, body, { headers: { 'content-type': 'text/plain', ...headers } });
};

const failure = async (): Promise<SlackSendError> => {
  try {
    await sender.send({ webhookUrl: URL, text: 'Synthetic' });
  } catch (error) {
    if (error instanceof SlackSendError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a SlackSendError');
};

describe('the incoming webhook', () => {
  it('posts the text with unfurling off', async () => {
    reply(200, 'ok');

    await expect(sender.send({ webhookUrl: URL, text: 'Synthetic' })).resolves.toEqual({});
    expect(bodies[0]).toEqual({ text: 'Synthetic', unfurl_links: false, unfurl_media: false });
  });

  it.each([
    [400, 'invalid_payload', 'slack_invalid_payload'],
    [400, 'user_not_found', 'slack_user_not_found'],
    [403, 'action_prohibited', 'slack_action_prohibited'],
    [403, 'invalid_token', 'slack_invalid_token'],
    [404, 'channel_not_found', 'slack_channel_not_found'],
    [404, 'no_service', 'slack_no_service'],
    [410, 'channel_is_archived', 'slack_channel_is_archived'],
  ])('maps a %i %s to %s, no retry', async (status, body, code) => {
    reply(status, body);

    expect(await failure()).toMatchObject({ code, retryable: false });
  });

  it('reads a word it does not know as a rejection, never echoing it', async () => {
    reply(400, 'something <unexpected> and long');

    const error = await failure();

    expect(error).toMatchObject({ code: 'slack_rejected', retryable: false });
    expect(String(error)).not.toContain('unexpected');
  });

  it('retries a 429, honouring Retry-After: proof of non-delivery', async () => {
    reply(429, 'rate_limited', { 'retry-after': '30' });

    expect(await failure()).toMatchObject({
      code: 'slack_rate_limited',
      retryable: true,
      retryAfterSeconds: 30,
    });
  });

  it('reads a 5xx as an unknown outcome', async () => {
    reply(500, 'rollup_error');

    expect(await failure()).toMatchObject({ code: 'slack_outcome_unknown', retryable: false });
  });

  it('reads a timeout or a broken connection as an unknown outcome', async () => {
    mock
      .get('https://hooks.slack.com')
      .intercept({ method: 'POST', path: URL_PATH })
      .replyWithError(new Error('socket hang up'));

    expect(await failure()).toMatchObject({ code: 'slack_outcome_unknown', retryable: false });
  });

  it('reads a refused connection as proof of non-delivery', async () => {
    const refused = Object.assign(new Error('connect'), { code: 'ECONNREFUSED' });
    mock
      .get('https://hooks.slack.com')
      .intercept({ method: 'POST', path: URL_PATH })
      .replyWithError(refused);

    expect(await failure()).toMatchObject({ code: 'slack_unreachable', retryable: true });
  });

  it('never carries the URL into an error', async () => {
    reply(404, 'no_service');

    expect(String(await failure())).not.toContain(URL_PATH);
  });

  it('refuses without an outbound factory', async () => {
    const lone = createSlackSender('incoming-webhook') as SlackSender;

    await expect(lone.send({ webhookUrl: URL, text: 'Synthetic' })).rejects.toMatchObject({
      code: 'slack_not_configured',
      retryable: false,
    });
  });
});
