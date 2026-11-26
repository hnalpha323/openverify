import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AcceptInvitationPage, { metadata } from './page';

vi.mock('../actions/invitations', () => ({ acceptInvitation: vi.fn() }));

describe('accept invitation page', () => {
  it('lets an invited operator choose a name and a password', () => {
    window.history.replaceState(null, '', `/accept-invitation#token=ovi_${'I'.repeat(43)}`);

    render(<AcceptInvitationPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Join OpenVerify' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Your name' })).toBeVisible();
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Accept your invitation');
  });
});
