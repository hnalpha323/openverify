import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import { InquirySessions, type InquirySessionsProps } from './inquiry-sessions';
import { LIFECYCLE_IDS as IDS, T1, session } from '../../testing/lifecycle-fixtures';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;
type CountAction = (
  state: ActionState<{ expiredCount: number }>,
  formData: FormData,
) => Promise<ActionResult<{ expiredCount: number }>>;

function renderSessions(props: Partial<InquirySessionsProps> = {}) {
  const expire = vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
  const expireAll = vi.fn<CountAction>(() =>
    Promise.resolve({ ok: true, data: { expiredCount: 1 } }),
  );
  render(
    <ToastProvider>
      <InquirySessions
        inquiryId={IDS.inquiry}
        sessions={[session(), session({ status: 'expired', 'started-at': null }, IDS.endedSession)]}
        masked={false}
        canExpire
        expire={expire}
        expireAll={expireAll}
        {...props}
      />
    </ToastProvider>,
  );
  return { expire, expireAll };
}

// C108: one card per session (a table until Workflow 7C).
const rowFor = (id: string) => screen.getByRole('article', { name: `Session ${id}` });

describe('InquirySessions', () => {
  it('lists the sessions with their status, times and client', () => {
    renderSessions({ canExpire: false });

    expect(screen.getByRole('list', { name: 'Inquiry sessions' })).toBeVisible();
    const active = rowFor(IDS.session);
    expect(within(active).getByText('Active')).toHaveAttribute('data-status', 'active');
    expect(within(active).getByText('203.0.113.7')).toBeVisible();
    expect(within(active).getByText('SyntheticBrowser/1.0')).toBeVisible();
    expect(within(rowFor(IDS.endedSession)).getByText('Expired')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the consent each session recorded: when, the locale, the required texts and the optional ones ticked (C42.3, C47)', () => {
    const consent = {
      'accepted-at': T1,
      'text-keys': ['consent.biometric', 'consent.processing'],
      'optional-text-keys': ['consent.biometric-matching'],
      locale: 'es',
    };
    renderSessions({
      canExpire: false,
      sessions: [
        session({ consent }),
        session(
          { status: 'expired', consent: { ...consent, 'optional-text-keys': [], locale: 'en' } },
          IDS.endedSession,
        ),
      ],
    });

    expect(within(rowFor(IDS.session)).getByText('Consent', { selector: 'dt' })).toBeVisible();
    const value = (id: string, term: string) =>
      within(rowFor(id)).getByText(term, { selector: 'dt' }).nextElementSibling;
    expect(value(IDS.session, 'Accepted (UTC)')).toHaveTextContent('Oct 20, 2026, 4:40 AM');
    expect(value(IDS.session, 'Locale')).toHaveTextContent('es');
    expect(value(IDS.session, 'Required texts')).toHaveTextContent(
      'consent.biometric, consent.processing',
    );
    expect(value(IDS.session, 'Optional texts')).toHaveTextContent('consent.biometric-matching');
    expect(within(rowFor(IDS.session)).getByText('consent.biometric-matching')).toHaveClass(
      'font-mono',
    );
    expect(value(IDS.endedSession, 'Optional texts')).toHaveTextContent('None ticked');
  });

  it('says when a session has no consent yet, and when the server does not report it', () => {
    renderSessions({
      canExpire: false,
      sessions: [session({ consent: null }), session({ status: 'expired' }, IDS.endedSession)],
    });

    expect(within(rowFor(IDS.session)).getByText('Not given yet')).toBeVisible();
    expect(within(rowFor(IDS.endedSession)).getByText('Not reported')).toBeVisible();
  });

  it('shows masked addresses as "Hidden"', () => {
    renderSessions({
      masked: true,
      sessions: [session({ 'ip-address': null, 'user-agent': null })],
    });

    expect(within(rowFor(IDS.session)).getAllByText('Hidden')).toHaveLength(2);
  });

  it('expires one active session after confirmation', async () => {
    const { expire } = renderSessions();

    expect(within(rowFor(IDS.endedSession)).queryByRole('button')).not.toBeInTheDocument();
    await userEvent.click(within(rowFor(IDS.session)).getByRole('button', { name: 'Expire' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expire session' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The session was expired.');
    const sent = expire.mock.calls[0]?.[1];
    expect(sent?.get('inquiry-session-id')).toBe(IDS.session);
    expect(sent?.get('inquiry-id')).toBe(IDS.inquiry);
  });

  it('expires every active session at once', async () => {
    const { expireAll } = renderSessions();

    await userEvent.click(screen.getByRole('button', { name: 'Expire all active sessions' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expire sessions' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'The active sessions were expired.',
    );
    expect(expireAll.mock.calls[0]?.[1].get('inquiry-id')).toBe(IDS.inquiry);
  });

  it('offers no expiry when no session is active', () => {
    renderSessions({ sessions: [session({ status: 'canceled' })] });

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says when the end user has not opened the flow yet', () => {
    renderSessions({ sessions: [] });

    expect(screen.getByText(/No sessions yet/)).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Inquiry sessions' })).not.toBeInTheDocument();
  });
});
