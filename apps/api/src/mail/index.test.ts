import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { MailerNotConfiguredError, createMailer } from './index.js';

// Synthetic addresses only; the SMTP server below is an in-process fake.
const FROM = 'OpenVerify <no-reply@example.test>';

interface ReceivedMail {
  from: string;
  to: string[];
  data: string;
}

interface FakeSmtpServer {
  url: string;
  received: ReceivedMail[];
  close(): Promise<void>;
}

/**
 * The smallest SMTP server nodemailer talks to (RFC 5321): greeting, EHLO, MAIL, RCPT, DATA and
 * QUIT. `refuseRecipients` answers RCPT with 550, as a server that rejects the address would.
 */
async function startFakeSmtpServer(
  options: { refuseRecipients?: boolean } = {},
): Promise<FakeSmtpServer> {
  const received: ReceivedMail[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    let buffer = '';
    let inData = false;
    let current: ReceivedMail = { from: '', to: [], data: '' };
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply('220 fake-smtp.example.test ESMTP ready');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          current.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          received.push(current);
          current = { from: '', to: [], data: '' };
          reply('250 2.0.0 queued');
          continue;
        }
        const newline = buffer.indexOf('\r\n');
        if (newline === -1) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') {
          reply('250-fake-smtp.example.test');
          reply('250 8BITMIME');
        } else if (verb === 'MAIL') {
          current.from = line;
          reply('250 2.1.0 ok');
        } else if (verb === 'RCPT') {
          if (options.refuseRecipients === true) {
            reply('550 5.1.1 mailbox unavailable');
          } else {
            current.to.push(line);
            reply('250 2.1.5 ok');
          }
        } else if (verb === 'DATA') {
          inData = true;
          reply('354 end with <CRLF>.<CRLF>');
        } else if (verb === 'QUIT') {
          reply('221 2.0.0 bye');
          socket.end();
        } else if (verb === 'RSET' || verb === 'NOOP') {
          reply('250 2.0.0 ok');
        } else {
          reply('502 5.5.2 not implemented');
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `smtp://127.0.0.1:${String(port)}`,
    received,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  };
}

const servers: FakeSmtpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function smtpServer(options?: { refuseRecipients?: boolean }) {
  const server = await startFakeSmtpServer(options);
  servers.push(server);
  return server;
}

describe('createMailer', () => {
  it('says whether an SMTP server is configured, so the OTP channel guard can read it (C54.3)', async () => {
    const server = await smtpServer();

    expect(createMailer({ smtpUrl: server.url, from: FROM }).configured).toBe(true);
    expect(createMailer({ smtpUrl: undefined, from: FROM }).configured).toBe(false);
  });

  it('addresses only the address object it is given, never a display name parsed from it (C55.8)', async () => {
    const server = await smtpServer();
    const mailer = createMailer({ smtpUrl: server.url, from: FROM });

    await mailer.send({
      to: { address: 'person@example.test' },
      subject: 'Synthetic code',
      text: 'Synthetic text.',
    });

    expect(server.received[0]?.to).toEqual(['RCPT TO:<person@example.test>']);
  });

  it('sends a message over SMTP from the configured sender', async () => {
    const server = await smtpServer();
    const mailer = createMailer({ smtpUrl: server.url, from: FROM });

    await mailer.send({
      to: { address: 'invitee@example.test' },
      subject: 'Synthetic subject',
      text: 'Synthetic plain text body.',
      html: '<p>Synthetic HTML body.</p>',
    });

    expect(server.received).toHaveLength(1);
    const [mail] = server.received;
    expect(mail?.from).toBe('MAIL FROM:<no-reply@example.test>');
    expect(mail?.to).toEqual(['RCPT TO:<invitee@example.test>']);
    expect(mail?.data).toContain('From: OpenVerify <no-reply@example.test>');
    expect(mail?.data).toContain('To: invitee@example.test');
    expect(mail?.data).toContain('Subject: Synthetic subject');
    expect(mail?.data).toContain('Synthetic plain text body.');
    expect(mail?.data).toContain('<p>Synthetic HTML body.</p>');
  });

  // KP11-72 (ASVS v5.0.0-1.3.11, Workflow 11F): a CR or LF in a subject never starts a header of its
  // own, and a line break in an address never adds a recipient: the message is sent with the subject
  // folded into one header, or the send is refused.
  const headerLines = (data: string) => data.slice(0, data.indexOf('\r\n\r\n')).split('\r\n');

  it.each([
    ['CRLF', 'Synthetic\r\nBcc: injected@example.test'],
    ['a bare LF', 'Synthetic\nBcc: injected@example.test'],
    ['a bare CR', 'Synthetic\rBcc: injected@example.test'],
  ])('never lets %s in a subject inject a header', async (_case, subject) => {
    const server = await smtpServer();
    const mailer = createMailer({ smtpUrl: server.url, from: FROM });

    await mailer.send({
      to: { address: 'invitee@example.test' },
      subject,
      text: 'Synthetic text.',
    });

    expect(server.received).toHaveLength(1);
    const [mail] = server.received;
    expect(mail?.to).toEqual(['RCPT TO:<invitee@example.test>']);
    expect(headerLines(mail?.data ?? '').filter((line) => /^bcc:/iu.test(line))).toEqual([]);
  });

  it('never lets a line break in an address add a recipient or a header', async () => {
    const server = await smtpServer();
    const mailer = createMailer({ smtpUrl: server.url, from: FROM });

    await mailer
      .send({
        to: { address: 'invitee@example.test\r\nBcc: injected@example.test' },
        subject: 'Synthetic subject',
        text: 'Synthetic text.',
      })
      .catch(() => undefined);

    for (const mail of server.received) {
      expect(mail.to.join('\n')).not.toContain('injected@example.test');
      expect(headerLines(mail.data).filter((line) => /^bcc:/iu.test(line))).toEqual([]);
    }
  });

  it('sends plain text alone when there is no HTML part', async () => {
    const server = await smtpServer();
    const mailer = createMailer({ smtpUrl: server.url, from: FROM });

    await mailer.send({
      to: { address: 'invitee@example.test' },
      subject: 'Plain',
      text: 'Only text.',
    });

    expect(server.received[0]?.data).toContain('Content-Type: text/plain');
    expect(server.received[0]?.data).not.toContain('text/html');
  });

  it('rejects when the server refuses the recipient', async () => {
    const server = await smtpServer({ refuseRecipients: true });
    const mailer = createMailer({ smtpUrl: server.url, from: FROM });

    await expect(
      mailer.send({
        to: { address: 'refused@example.test' },
        subject: 'Refused',
        text: 'Refused.',
      }),
    ).rejects.toThrow();
    expect(server.received).toEqual([]);
  });

  it('rejects when the server cannot be reached', async () => {
    const server = await smtpServer();
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    const mailer = createMailer({ smtpUrl: server.url, from: FROM, timeoutMs: 2_000 });

    await expect(
      mailer.send({
        to: { address: 'invitee@example.test' },
        subject: 'Unreachable',
        text: 'Unreachable.',
      }),
    ).rejects.toThrow();
  });

  it('refuses to send when no SMTP server is configured', async () => {
    const mailer = createMailer({ smtpUrl: undefined, from: FROM });

    const call = mailer.send({
      to: { address: 'invitee@example.test' },
      subject: 'None',
      text: 'None.',
    });

    await expect(call).rejects.toBeInstanceOf(MailerNotConfiguredError);
    await expect(call).rejects.toThrow('OPENVERIFY_SMTP_URL');
  });

  it('refuses a URL that is not smtp:// or smtps://', () => {
    expect(() => createMailer({ smtpUrl: 'http://127.0.0.1:1025', from: FROM })).toThrow(
      RangeError,
    );
  });
});
