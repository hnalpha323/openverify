/**
 * C126.1, C126.2: links are checked on the rendered message, so a URL or a host a value carried in is
 * refused as surely as one the operator wrote. Every host here is synthetic.
 */
import { describe, expect, it } from 'vitest';
import { messageLinksAllowed } from './links.js';

const rules = { hosts: ['links.example.com'], exact: [] };

describe('messageLinksAllowed', () => {
  it.each([
    'Your review is ready.',
    'See https://links.example.com/a?b=c for more.',
    'See HTTPS://LINKS.EXAMPLE.COM/a for more.',
    'Costs 1.50 at 3.5 percent, version 2.1.',
    'Write to support@example.com.',
    '',
  ])('takes %j', (text) => {
    expect(messageLinksAllowed(text, rules)).toBe(true);
  });

  it.each([
    'Go to https://evil.example/a',
    'Go to https://links.example.com.evil.example/a',
    'Go to https://links.example.com@evil.example/a',
    'Go to http://links.example.com/a',
    'Go to ftp://links.example.com/a',
    'Go to //evil.example/a',
    'Go to evil.example',
    'Go to evil.example/a?b=c',
    'Go to www.evil.example.',
    'Go to EVIL.EXAMPLE',
    'Go to evil．example',
    'Go to e​vil.example',
    'Go to пример.рф',
    'Go to 203.0.113.9/a',
    'javascript:alert(1)',
    'data:text/html,synthetic',
    'mailto:someone@example.com',
  ])('refuses %j', (text) => {
    expect(messageLinksAllowed(text, rules)).toBe(false);
  });

  it('takes the exact link it is given, whatever its host', () => {
    const link = 'https://flow.example.test/inquiries/one-time-link/abc?token=synthetic';

    expect(messageLinksAllowed(`Open ${link} now`, { hosts: [], exact: [link] })).toBe(true);
    expect(messageLinksAllowed(`Open ${link}x now`, { hosts: [], exact: [link] })).toBe(false);
  });

  it('reads HTML as a browser would', () => {
    const html = (href: string) => `<a href="${href}">Open</a>`;

    expect(messageLinksAllowed(html('https://links.example.com/a'), rules)).toBe(true);
    expect(messageLinksAllowed(html('https://evil.example/a'), rules)).toBe(false);
    expect(messageLinksAllowed(html('&#104;ttps://evil.example/a'), rules)).toBe(false);
    expect(messageLinksAllowed(html('https&#58;//evil.example/a'), rules)).toBe(false);
    expect(messageLinksAllowed(html('https:&#x2F;&#x2F;evil.example/a'), rules)).toBe(false);
  });
});
