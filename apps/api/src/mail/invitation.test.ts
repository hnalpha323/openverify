import { newInvitationToken } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { invitationAcceptUrl, invitationEmail, invitationTokenFromUrl } from './invitation.js';

describe('invitationAcceptUrl', () => {
  it('puts the token in the fragment of the dashboard acceptance page (C15)', () => {
    const token = newInvitationToken();

    expect(invitationAcceptUrl('https://dashboard.example.test', token)).toBe(
      `https://dashboard.example.test/accept-invitation#token=${token}`,
    );
  });

  it('keeps a base path and drops a trailing slash', () => {
    const token = newInvitationToken();

    expect(invitationAcceptUrl('https://example.test/console/', token)).toBe(
      `https://example.test/console/accept-invitation#token=${token}`,
    );
  });

  it('round-trips through invitationTokenFromUrl', () => {
    const token = newInvitationToken();

    expect(invitationTokenFromUrl(invitationAcceptUrl('http://localhost:3001', token))).toBe(token);
    expect(invitationTokenFromUrl('http://localhost:3001/accept-invitation')).toBeNull();
    expect(invitationTokenFromUrl('not a url')).toBeNull();
  });
});

describe('invitationEmail', () => {
  const token = newInvitationToken();
  const acceptUrl = invitationAcceptUrl('https://dashboard.example.test', token);
  const message = invitationEmail({
    to: 'invitee@example.test',
    organizationName: 'Example Synthetic Org',
    acceptUrl,
    expiresAt: new Date('2026-10-27T12:00:00.000Z'),
  });

  it('addresses the invitee with a plain subject', () => {
    expect(message.to).toEqual({ address: 'invitee@example.test' });
    expect(message.subject).toBe('You are invited to Example Synthetic Org on OpenVerify');
  });

  it('carries the acceptance link and its expiry in the text and HTML parts', () => {
    expect(message.text).toContain(acceptUrl);
    expect(message.text).toContain('2026-10-27 12:00 UTC');
    expect(message.html).toContain(`href="${acceptUrl}"`);
    expect(message.html).toContain('2026-10-27 12:00 UTC');
  });

  it('escapes the organization name in the HTML part', () => {
    const html = invitationEmail({
      to: 'invitee@example.test',
      organizationName: '<script>alert("x")</script> & Co',
      acceptUrl,
      expiresAt: new Date('2026-10-27T12:00:00.000Z'),
    }).html;

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Co');
  });
});
