import { describe, expect, it, vi } from 'vitest';
import { waitForMail } from './mailpit.js';

const MAILPIT = 'http://127.0.0.1:41006';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('waitForMail', () => {
  it('finds the newest message to an address through the Mailpit API and reads it', async () => {
    const fetch = vi.fn((url: string) => {
      if (url.startsWith(`${MAILPIT}/api/v1/search?`)) {
        expect(new URL(url).searchParams.get('query')).toBe('to:"invitee@example.test"');
        return Promise.resolve(json({ messages: [{ ID: 'msg-2' }, { ID: 'msg-1' }] }));
      }
      expect(url).toBe(`${MAILPIT}/api/v1/message/msg-2`);
      return Promise.resolve(
        json({ Subject: 'You are invited', Text: 'Accept: http://x/#token=ovi_1', HTML: '' }),
      );
    });

    const mail = await waitForMail(MAILPIT, 'invitee@example.test', { fetch, timeoutMs: 1_000 });

    expect(mail).toEqual({
      id: 'msg-2',
      subject: 'You are invited',
      text: 'Accept: http://x/#token=ovi_1',
      html: '',
    });
  });

  it('polls until the message arrives', async () => {
    let searches = 0;
    const fetch = vi.fn((url: string) => {
      if (url.includes('/search?')) {
        searches += 1;
        return Promise.resolve(json({ messages: searches < 3 ? [] : [{ ID: 'late' }] }));
      }
      return Promise.resolve(json({ Subject: 'Late', Text: 'body', HTML: '<p>body</p>' }));
    });

    const mail = await waitForMail(MAILPIT, 'invitee@example.test', {
      fetch,
      timeoutMs: 5_000,
      intervalMs: 1,
    });

    expect(searches).toBe(3);
    expect(mail.subject).toBe('Late');
  });

  it('skips the messages it is told were read already, waiting for a newer one', async () => {
    let searches = 0;
    const fetch = vi.fn((url: string) => {
      if (url.includes('/search?')) {
        searches += 1;
        const messages = searches < 2 ? [{ ID: 'old' }] : [{ ID: 'new' }, { ID: 'old' }];
        return Promise.resolve(json({ messages }));
      }
      expect(url).toBe(`${MAILPIT}/api/v1/message/new`);
      return Promise.resolve(json({ Subject: 'Second code', Text: 'body', HTML: '' }));
    });

    const mail = await waitForMail(MAILPIT, 'invitee@example.test', {
      fetch,
      timeoutMs: 5_000,
      intervalMs: 1,
      exceptIds: ['old'],
    });

    expect(searches).toBe(2);
    expect(mail).toMatchObject({ id: 'new', subject: 'Second code' });
  });

  it('gives up after the timeout, naming the address', async () => {
    const fetch = vi.fn(() => Promise.resolve(json({ messages: [] })));

    await expect(
      waitForMail(MAILPIT, 'nobody@example.test', { fetch, timeoutMs: 20, intervalMs: 5 }),
    ).rejects.toThrow('No email to nobody@example.test arrived in Mailpit within 20 ms');
  });

  it('fails on an error answer from Mailpit', async () => {
    const fetch = vi.fn(() => Promise.resolve(json({ error: 'down' }, 500)));

    await expect(
      waitForMail(MAILPIT, 'invitee@example.test', { fetch, timeoutMs: 1_000 }),
    ).rejects.toThrow('Mailpit answered 500');
  });
});
