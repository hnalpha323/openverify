/**
 * C169.8 (S24; review P29; Workflow 9B, `api-keys-webhooks`): the From header built from an
 * environment's `mail-sender-name` and the install-wide `OPENVERIFY_MAIL_FROM`. Each case is rendered
 * by nodemailer's own composer (what the SMTP transport sends), then read back: the address must stay
 * the install's, the display name must read back exactly, a non-ASCII name must go out RFC 2047-encoded
 * and a name with specials RFC 5322-quoted. Every name and address is synthetic.
 */
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { describe, expect, it } from 'vitest';
import { formatSender } from './sender-name.js';

const ADDRESS = 'no-reply@example.test';
const FROM = `OpenVerify <${ADDRESS}>`;

/** The unfolded From header nodemailer writes for `from`. */
async function fromHeader(from: string): Promise<string> {
  const message = await new MailComposer({
    from,
    to: 'operator@example.test',
    subject: 'Synthetic',
    text: 'Synthetic',
  })
    .compile()
    .build();
  const lines = message.toString('utf8').split('\r\n');
  const start = lines.findIndex((line) => line.startsWith('From: '));
  const folded = [lines[start] ?? ''];
  for (const line of lines.slice(start + 1)) {
    if (!/^[ \t]/.test(line)) break;
    folded.push(line);
  }
  return folded.join('\r\n').slice('From: '.length);
}

/** RFC 2047 decoding of the UTF-8 encoded words in a phrase (whitespace between two is dropped). */
function decodeWords(phrase: string): string {
  const joined = phrase.replace(/\?=\s+=\?/g, '?==?');
  return joined.replace(/=\?UTF-8\?([BQ])\?([^?]*)\?=/gi, (_, encoding: string, text: string) => {
    const bytes =
      encoding.toUpperCase() === 'B'
        ? Buffer.from(text, 'base64')
        : Buffer.from(
            text
              .replace(/_/g, ' ')
              .replace(/=([0-9A-F]{2})/gi, (__, hex: string) =>
                String.fromCharCode(Number.parseInt(hex, 16)),
              ),
            'latin1',
          );
    return bytes.toString('utf8');
  });
}

/** The display name and address of a written From header, as a mail client reads them. */
function readBack(header: string): { name: string; address: string } {
  const unfolded = header.replace(/\r\n[ \t]+/g, ' ');
  const match = /^(.*)<([^<>]+)>$/.exec(unfolded);
  if (match === null) throw new Error(`no address in ${unfolded}`);
  const phrase = (match[1] ?? '').trim();
  const name = phrase.startsWith('"')
    ? phrase.slice(1, -1).replace(/\\(.)/g, '$1')
    : decodeWords(phrase);
  return { name, address: match[2] ?? '' };
}

describe('formatSender (C169.8)', () => {
  it('keeps the install-wide From as it is without a sender name', async () => {
    expect(formatSender(null, FROM)).toBe(FROM);
    expect(readBack(await fromHeader(formatSender(null, FROM)))).toEqual({
      name: 'OpenVerify',
      address: ADDRESS,
    });
  });

  it.each([
    ['a plain name', 'Synthetic Bank'],
    ['a name with specials, quoted', 'Synthetic Bank, Inc. (Alerts); Team: Ops'],
    ['a backslash, escaped in the quotes', 'Synthetic \\ Bank \\'],
    ['an apostrophe and a slash', "Synthetic's Bank / Alerts"],
  ])('puts %s before the install-wide address', async (_, name) => {
    const header = await fromHeader(formatSender(name, FROM));

    expect(readBack(header)).toEqual({ name, address: ADDRESS });
    // RFC 5322: a phrase holding a special is a quoted string.
    if (/[^\w ]/.test(name)) {
      expect(header.startsWith('"')).toBe(true);
    }
  });

  it('encodes a non-ASCII name with RFC 2047 and keeps the address', async () => {
    for (const name of ['Bänk Sécurité', 'بنك تجريبي', '合成銀行', 'Synthetic 🏦']) {
      const header = await fromHeader(formatSender(name, FROM));

      expect(header, name).toMatch(/^=\?UTF-8\?[BQ]\?/);
      expect(/^[\x20-\x7e\r\n\t]*$/.test(header), name).toBe(true);
      expect(readBack(header), name).toEqual({ name, address: ADDRESS });
    }
  });

  it('takes the address of a From with or without a display name of its own', async () => {
    for (const from of [ADDRESS, `<${ADDRESS}>`, FROM, `"Open, Verify" <${ADDRESS}>`]) {
      expect(readBack(await fromHeader(formatSender('Synthetic Bank', from))), from).toEqual({
        name: 'Synthetic Bank',
        address: ADDRESS,
      });
    }
  });

  it('trims the name as the setting does', async () => {
    expect(readBack(await fromHeader(formatSender('  Synthetic Bank  ', FROM)))).toEqual({
      name: 'Synthetic Bank',
      address: ADDRESS,
    });
  });

  describe('the spoofing examples (review P29): the address never moves', () => {
    it.each([
      ['an address of its own', 'Bank Security <alerts@bank.example>'],
      ['an at sign', 'alerts@bank.example'],
      ['a quote closing the phrase', 'Bank" <alerts@bank.example>'],
      ['a header injection', 'Bank\r\nBcc: victim@example.test'],
      ['a line feed', 'Bank\nReply-To: alerts@bank.example'],
      ['a NUL', 'Bank\u0000'],
      ['an angle bracket alone', 'Bank Security >'],
      [
        'an encoded word that decodes to an address',
        '=?UTF-8?B?QmFuayA8YWxlcnRzQGJhbmsuZXhhbXBsZT4=?=',
      ],
      ['a bidi override', 'Bank \u202eelpmaxe.knab'],
      ['an empty name', '   '],
      ['a name over 100 characters', 'B'.repeat(101)],
    ])('keeps the install-wide From for %s', async (_, name) => {
      expect(formatSender(name, FROM)).toBe(FROM);
      expect(readBack(await fromHeader(formatSender(name, FROM))).address).toBe(ADDRESS);
    });

    it('sends look-alike characters encoded, as the name they are, with the install address', async () => {
      const name = 'Ｂａｎｋ Security ＜alerts＠bank.example＞';
      const header = await fromHeader(formatSender(name, FROM));

      expect(readBack(header)).toEqual({ name, address: ADDRESS });
      expect(header.endsWith(`<${ADDRESS}>`)).toBe(true);
    });
  });
});
