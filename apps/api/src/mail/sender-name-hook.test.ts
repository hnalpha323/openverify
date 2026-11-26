/**
 * Workflow 9B Stage 1b, checkpoint (W) (C169.8; contracts B33): the mailer's From goes through
 * `formatSender` (`mail/sender-name.ts`, `api-keys-webhooks`) with the message's sender name and the
 * install-wide address; `api-keys-webhooks` built it (the name quoted before the install's
 * address). nodemailer is replaced by a recording transport, so nothing is sent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMailer } from './index.js';
import { formatSender } from './sender-name.js';

const sent = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock('nodemailer', () => ({
  createTransport: () => ({
    sendMail: (message: Record<string, unknown>) => {
      sent.push(message);
      return Promise.resolve({});
    },
  }),
}));
vi.mock('./sender-name.js', { spy: true });

// Synthetic addresses only.
const FROM = 'OpenVerify <no-reply@example.test>';
const mailer = () => createMailer({ smtpUrl: 'smtp://127.0.0.1:1025', from: FROM });
const message = { to: { address: 'operator@example.test' }, subject: 'Synthetic', text: 'Hello' };

afterEach(() => {
  sent.splice(0);
  vi.clearAllMocks();
});

describe('the mailer’s From (C169.8)', () => {
  it('is what formatSender answers for the message’s sender name and the install-wide From', async () => {
    vi.mocked(formatSender).mockImplementationOnce(
      () => '"Synthetic Bank" <no-reply@example.test>',
    );

    await mailer().send({ ...message, senderName: 'Synthetic Bank' });

    expect(formatSender).toHaveBeenCalledWith('Synthetic Bank', FROM);
    expect(sent.map((mail) => mail.from)).toEqual(['"Synthetic Bank" <no-reply@example.test>']);
  });

  it('asks with null when the message names no sender', async () => {
    await mailer().send(message);

    expect(formatSender).toHaveBeenCalledWith(null, FROM);
  });

  it('puts the sender name before the install-wide address (built by api-keys-webhooks)', async () => {
    await mailer().send({ ...message, senderName: 'Synthetic Bank' });
    await mailer().send(message);

    expect(sent.map((mail) => mail.from)).toEqual([
      '"Synthetic Bank" <no-reply@example.test>',
      FROM,
    ]);
  });
});
