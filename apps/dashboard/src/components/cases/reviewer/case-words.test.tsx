/**
 * C142.2, C142.7: the case page's words. Every state is said in words; an SLA says the time left;
 * a sandbox scan says it is no real scan (C135.5, H20); a comment is plain text, where a mention
 * names its person, an id links to its own page, and a web address stays text until its host shows.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  REVIEWER_IDS as IDS,
  STATUSES,
  attachment,
  historyEntry,
} from '../../../testing/reviewer-fixtures';
import { buildCaseAttachment } from '@openverify/contracts';
import {
  durationWords,
  historyDetails,
  historySentence,
  renditionWords,
  scanWords,
  sizeWords,
  slaWords,
  statusLabel,
} from './case-words';
import { CommentText } from './comment-text';

const NOW = Date.parse('2026-11-03T10:00:00.000Z');

describe('case words', () => {
  it.each([
    [59_000, 'less than a minute'],
    [60_000, '1 minute'],
    [7_500_000, '2 hours 5 minutes'],
    [90_061_000, '1 day 1 hour'],
  ])('says %i ms as "%s"', (milliseconds, words) => {
    expect(durationWords(milliseconds)).toBe(words);
  });

  it('says each SLA state, with the time left or past while it runs', () => {
    expect(slaWords('none', null, NOW)).toBe('No SLA');
    expect(slaWords('paused', null, NOW)).toBe('Paused: the status pauses the deadline');
    expect(slaWords('met', '2026-11-03T09:00:00.000Z', NOW)).toBe('Met before its deadline');
    expect(slaWords('expired', '2026-11-03T09:00:00.000Z', NOW)).toBe(
      'Expired: the deadline passed',
    );
    expect(slaWords('running', '2026-11-03T12:05:00.000Z', NOW)).toBe(
      'Running: 2 hours 5 minutes left',
    );
    expect(slaWords('running', '2026-11-03T09:30:00.000Z', NOW)).toBe(
      'Running: 30 minutes past the deadline',
    );
    expect(slaWords('running', null, NOW)).toBe('Running');
  });

  it('labels a status by its version, and names one it does not hold by its key', () => {
    expect(statusLabel(STATUSES, 'pending')).toBe('Pending');
    expect(statusLabel(STATUSES, 'retired')).toBe('retired');
    expect(statusLabel(null, undefined)).toBe('none');
  });

  it('says a timeline entry in words, with its scalar details', () => {
    expect(
      historySentence(historyEntry({ kind: 'resolved', to: { resolution: 'Declined' } }), STATUSES),
    ).toBe('Resolved: Declined');
    expect(historySentence(historyEntry({ kind: 'sla-expired', to: null }), STATUSES)).toBe(
      'SLA expired',
    );
    expect(historyDetails({ keys: ['a', 'b'], count: 2, gone: null, nested: { a: 1 } })).toEqual([
      'keys: a, b',
      'count: 2',
      'gone: none',
    ]);
    expect(historyDetails(null)).toEqual([]);
  });

  it('says how a file was scanned and rendered, and its size', () => {
    const scanned = (changes: Parameters<typeof attachment>[0]) =>
      buildCaseAttachment(attachment(changes));
    expect(scanWords(scanned({}))).toBe('Clean, sandbox scan (not a real scan)');
    expect(scanWords(scanned({ scanProvider: 'clamd' }))).toBe('Clean, scanned by ClamAV');
    expect(scanWords(scanned({ scanStatus: 'infected', scanProvider: 'sandbox' }))).toBe(
      'Infected: never served, sandbox scan (not a real scan)',
    );
    expect(renditionWords(scanned({ attachmentType: 'pdf', pageCount: 3 }))).toBe('Ready, 3 pages');
    expect(renditionWords(scanned({ renditionStatus: 'pending', pageCount: null }))).toBe(
      'Being prepared',
    );
    expect(sizeWords(512)).toBe('512 B');
    expect(sizeWords(48_213)).toBe('47.1 KiB');
    expect(sizeWords(10 * 1_048_576)).toBe('10.0 MiB');
  });
});

describe('CommentText', () => {
  it('names mentions, links ids to their pages and keeps a web address as text until asked', async () => {
    const user = userEvent.setup();
    render(
      <CommentText
        message={`For @[${IDS.colleague}] and @[${IDS.me}]: see ${IDS.case} at https://docs.example.test/a?b=1\nnext line`}
        viewerId={IDS.me}
        people={new Map([[IDS.colleague, 'colleague@example.test']])}
      />,
    );

    expect(screen.getByText('@colleague@example.test')).toBeVisible();
    expect(screen.getByText('@you')).toBeVisible();
    expect(screen.getByRole('link', { name: IDS.case })).toHaveAttribute(
      'href',
      `/cases/${IDS.case}`,
    );
    expect(screen.queryByRole('link', { name: /docs\.example\.test/ })).toBeNull();

    const open = screen.getByRole('button', { name: 'Open link' });
    expect(open).toHaveAttribute('aria-expanded', 'false');
    await user.click(open);
    expect(screen.getByText('docs.example.test', { selector: 'strong' })).toBeVisible();
    const link = screen.getByRole('link', { name: 'Go to docs.example.test' });
    expect(link).toHaveAttribute('href', 'https://docs.example.test/a?b=1');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  });

  it('renders markup as text, never as markup', () => {
    const { container } = render(
      <CommentText message={'<img src=x onerror=alert(1)> **bold**'} viewerId={IDS.me} />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)> **bold**');
  });
});
