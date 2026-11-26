import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InquiryTimeline } from './inquiry-timeline';
import {
  LIFECYCLE_IDS as IDS,
  inquiryEvent,
  sessionEvent,
  verificationEvent,
} from '../../testing/lifecycle-fixtures';
import {
  SELFIE_IDS,
  selfieCapture,
  selfieEvent,
  supersededCapture,
} from '../../testing/selfie-fixtures';
import { PHASE5_RESOURCE_TYPES, phase5Verification } from '../../testing/phase5-fixtures';
import { VERIFICATION_TYPE_LABELS } from '../../lib/labels';
import { eventResourceSchema } from '@openverify/contracts';

describe('InquiryTimeline', () => {
  it('lists the events, newest first, with what happened and when', () => {
    render(
      <InquiryTimeline
        inquiryId={IDS.inquiry}
        events={[
          inquiryEvent('inquiry.transitioned', IDS.otherEvent, {
            from: 'completed',
            to: 'approved',
          }),
          inquiryEvent('inquiry.approved', IDS.event),
        ]}
        nextCursor={null}
      />,
    );

    const items = within(screen.getByRole('list', { name: 'Timeline' })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const [transitioned, approved] = items;
    if (transitioned === undefined || approved === undefined) throw new Error('two items');
    expect(transitioned).toHaveTextContent('Status changed from Completed to Approved');
    expect(transitioned).toHaveTextContent('inquiry.transitioned');
    expect(approved).toHaveTextContent('Approved');
    expect(within(approved).getByText(/Oct 20, 2026/).tagName).toBe('TIME');
  });

  it('names every inquiry event, and shows any other by its name', () => {
    render(
      <InquiryTimeline
        inquiryId={IDS.inquiry}
        events={[
          inquiryEvent('inquiry.updated-tags'),
          inquiryEvent('inquiry.redacted', IDS.otherEvent),
        ]}
        nextCursor={null}
      />,
    );

    expect(screen.getByText('Tags changed')).toBeVisible();
    expect(screen.getByText('Redacted')).toBeVisible();
  });

  it("names the events of the inquiry's verifications and sessions (C25.7)", () => {
    render(
      <InquiryTimeline
        inquiryId={IDS.inquiry}
        events={[
          verificationEvent('verification.passed', IDS.event),
          verificationEvent('verification.created', IDS.otherEvent),
          sessionEvent('inquiry-session.started', 'evt_01JB0000000000000000000003'),
          sessionEvent('inquiry-session.canceled', 'evt_01JB0000000000000000000004'),
        ]}
        nextCursor={null}
      />,
    );

    const items = within(screen.getByRole('list', { name: 'Timeline' })).getAllByRole('listitem');
    expect(items.map((item) => item.firstElementChild?.textContent)).toEqual([
      'Government ID verification passed',
      'Government ID verification started',
      'Session started',
      'Session canceled',
    ]);
    // Without verifications:read, nothing links the verification.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('links a verification event to its verification with verifications:read (C26)', () => {
    render(
      <InquiryTimeline
        inquiryId={IDS.inquiry}
        events={[verificationEvent('verification.failed')]}
        nextCursor={null}
        linkVerifications
      />,
    );

    expect(screen.getByRole('link', { name: 'Government ID verification failed' })).toHaveAttribute(
      'href',
      `/verifications/${IDS.governmentId}`,
    );
  });

  it.each(PHASE5_RESOURCE_TYPES)(
    'names the events of a %s verification and links them to it (C54.5)',
    (type) => {
      const verification = phase5Verification(type);
      render(
        <InquiryTimeline
          inquiryId={IDS.inquiry}
          events={[
            eventResourceSchema.parse({
              type: 'event',
              id: IDS.event,
              attributes: {
                name: 'verification.passed',
                payload: { data: verification },
                simulated: false,
                'created-at': verification.attributes['created-at'],
              },
            }),
          ]}
          nextCursor={null}
          linkVerifications
        />,
      );

      expect(
        screen.getByRole('link', { name: `${VERIFICATION_TYPE_LABELS[type]} verification passed` }),
      ).toHaveAttribute('href', `/verifications/${verification.id}`);
    },
  );

  it('names the selfie capture events, says why one errored, and links them to their verification (C40.8, C47)', () => {
    render(
      <InquiryTimeline
        inquiryId={IDS.inquiry}
        events={[
          selfieEvent('selfie.processed', selfieCapture(), 'evt_01JB0000000000000000000011'),
          selfieEvent('selfie.submitted', selfieCapture(), 'evt_01JB0000000000000000000012'),
          selfieEvent('selfie.created', selfieCapture(), 'evt_01JB0000000000000000000013'),
          selfieEvent('selfie.errored', supersededCapture(), 'evt_01JB0000000000000000000014'),
        ]}
        nextCursor={null}
        linkVerifications
      />,
    );

    const timeline = screen.getByRole('list', { name: 'Timeline' });
    for (const words of [
      'Selfie capture processed',
      'Selfie capture submitted',
      'Selfie capture started',
      'Selfie capture errored (Superseded)',
    ]) {
      expect(within(timeline).getByRole('link', { name: words })).toHaveAttribute(
        'href',
        `/verifications/${SELFIE_IDS.selfie}`,
      );
    }
    expect(within(timeline).getByText('selfie.errored')).toBeVisible();
  });

  it('names a redacted selfie event without a link, and links none without verifications:read', () => {
    render(
      <InquiryTimeline
        inquiryId={IDS.inquiry}
        events={[
          selfieEvent('selfie.errored', 'redacted', 'evt_01JB0000000000000000000011'),
          selfieEvent('selfie.processed', selfieCapture(), 'evt_01JB0000000000000000000012'),
        ]}
        nextCursor={null}
      />,
    );

    expect(screen.getByText('Selfie capture errored')).toBeVisible();
    expect(screen.getByText('Selfie capture processed')).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('links to older events, and back to the newest', () => {
    render(
      <InquiryTimeline
        inquiryId={IDS.inquiry}
        events={[inquiryEvent('inquiry.created')]}
        after={IDS.otherEvent}
        nextCursor={IDS.event}
      />,
    );

    const nav = screen.getByRole('navigation', { name: 'Timeline pages' });
    expect(within(nav).getByRole('link', { name: 'Older events' })).toHaveAttribute(
      'href',
      `/inquiries/${IDS.inquiry}?events-after=${IDS.event}`,
    );
    expect(within(nav).getByRole('link', { name: 'Newest events' })).toHaveAttribute(
      'href',
      `/inquiries/${IDS.inquiry}`,
    );
  });

  it('says when there are no events yet', () => {
    render(<InquiryTimeline inquiryId={IDS.inquiry} events={[]} nextCursor={null} />);

    expect(screen.getByText('No events yet.')).toBeVisible();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
