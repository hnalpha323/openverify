import type { ListMatchResource } from '@openverify/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { inquiry } from '../../testing/lifecycle-fixtures';
import { later } from '../../testing/later';
import {
  NOT_COMPUTED_SIGNALS,
  SIGNAL_IDS as IDS,
  computedSignals,
  ipRangeMatch,
  listMatch,
  maskedMatch,
} from '../../testing/signals-fixtures';
import { ToastProvider } from '../toasts';
import { ListMatches, ListScreening, screeningViewOf } from './list-matches';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

type InquiryAttributes = NonNullable<Parameters<typeof inquiry>[0]>;

/** The screening view of an inquiry with `attributes`: its details, and its count in `signals`. */
const viewOf = (attributes: InquiryAttributes) => {
  const served = inquiry(attributes).attributes;
  return screeningViewOf(served['signal-details'], served.signals);
};

function withScreening(
  screening: Record<string, unknown> | null,
  nullReason: string | null,
  value: number | null,
) {
  const computed = computedSignals();
  const details = { ...computed['signal-details'] } as Record<string, unknown>;
  const entry = details['inquiry/list_match_count'] as Record<string, unknown>;
  const next: Record<string, unknown> = { ...entry, 'null-reason': nullReason };
  if (screening === null) {
    delete next['list-screening'];
  } else {
    next['list-screening'] = screening;
  }
  details['inquiry/list_match_count'] = next;
  return viewOf({
    signals: (computed.signals ?? []).map((signal) =>
      signal.name === 'inquiry/list_match_count' ? { ...signal, value } : signal,
    ),
    'signal-details': details as InquiryAttributes['signal-details'],
  });
}

function showMatches(
  matches: readonly ListMatchResource[],
  options: { piiView?: boolean; canDismiss?: boolean; dismiss?: Action } = {},
) {
  const dismiss = options.dismiss ?? vi.fn<Action>(() => later({ ok: true, data: undefined }));
  render(
    <ToastProvider>
      <ListMatches
        matches={matches}
        piiView={options.piiView ?? true}
        listsLinked
        canDismiss={options.canDismiss ?? true}
        dismiss={dismiss}
        revalidate={{ 'inquiry-id': IDS.inquiry }}
      />
    </ToastProvider>,
  );
  return dismiss;
}

const matchRow = (id: string) => {
  const found = screen.getByRole('rowheader', { name: id }).closest('tr');
  if (found === null) throw new Error(`No row for ${id}`);
  return found;
};

describe('the list screening of an inquiry (C99.4, C108; H02, H31)', () => {
  it('says a partial screening, each unscreened list with its reason, never "no match"', () => {
    render(<ListScreening view={viewOf(computedSignals())} listsLinked />);

    const screening = screen.getByRole('group', { name: 'List screening' });
    expect(screening).toHaveTextContent('Partly screened: some lists were not screened');
    const lists = within(screening).getByRole('list', { name: 'Selected lists' });
    expect(within(lists).getByText(IDS.otherList).closest('li')).toHaveTextContent(
      'Not screened: its items are still being prepared',
    );
    expect(within(lists).getByText(IDS.thirdList).closest('li')).toHaveTextContent(
      'No value to compare',
    );
    expect(within(lists).getByRole('link', { name: IDS.otherList })).toHaveAttribute(
      'href',
      `/lists/${IDS.otherList}`,
    );
    expect(screening).toHaveTextContent('Decided before the list screening finished');
    expect(screening).not.toHaveTextContent(/no match/i);
  });

  it.each([
    ['pending', 'Screening not finished'],
    ['errored', 'Screening errored: not screened'],
  ])('never reads a %s screening as "no match"', (status, words) => {
    render(
      <ListScreening
        view={withScreening(
          { status, unscreened: [], 'not-applicable': [], 'review-cause': null },
          'list_unscreened',
          null,
        )}
        listsLinked
      />,
    );

    const screening = screen.getByRole('group', { name: 'List screening' });
    expect(screening).toHaveTextContent(words);
    expect(screening).not.toHaveTextContent(/no match|no list matched/i);
  });

  it('says a completed screening with its count', () => {
    render(
      <ListScreening
        view={withScreening(
          { status: 'completed', unscreened: [], 'not-applicable': [], 'review-cause': null },
          null,
          0,
        )}
        listsLinked
      />,
    );

    expect(screen.getByRole('group', { name: 'List screening' })).toHaveTextContent(
      'Screened: 0 open matches',
    );
  });

  it('says a screening still pending, before its row ends', () => {
    render(
      <ListScreening view={withScreening(null, 'list_screening_pending', null)} listsLinked />,
    );

    expect(screen.getByRole('group', { name: 'List screening' })).toHaveTextContent(
      'Screening not finished',
    );
  });

  it('says when no list is selected', () => {
    render(<ListScreening view={withScreening(null, 'no_lists_selected', null)} listsLinked />);

    expect(screen.getByRole('group', { name: 'List screening' })).toHaveTextContent(
      'No list is selected for screening',
    );
  });

  it('says "Not screened yet" before the signals are computed', () => {
    render(<ListScreening view={viewOf(NOT_COMPUTED_SIGNALS)} listsLinked />);

    expect(screen.getByRole('group', { name: 'List screening' })).toHaveTextContent(
      'Not screened yet',
    );
  });
});

describe('the list matches (C99.3, C108; H15)', () => {
  it('shows each match with its list, source, method, tier and value', () => {
    showMatches([listMatch(), ipRangeMatch()]);

    const exact = matchRow(IDS.match);
    expect(within(exact).getByRole('link', { name: IDS.list })).toHaveAttribute(
      'href',
      `/lists/${IDS.list}`,
    );
    expect(exact).toHaveTextContent('Confirmed email address');
    expect(exact).toHaveTextContent('Exact');
    expect(exact).toHaveTextContent('R (an exact comparison)');
    expect(exact).toHaveTextContent('listed@example.test');
    expect(exact).toHaveTextContent('Open');
    const ip = matchRow(IDS.ipMatch);
    expect(ip).toHaveTextContent('Inside an IP range');
    expect(ip).toHaveTextContent('approximate');
  });

  it('marks an H-tier match beta, with its confidence and score', () => {
    showMatches([listMatch({ method: 'fuzzy_name', tier: 'H', confidence: 0.91, score: 0.91 })]);

    const row = matchRow(IDS.match);
    expect(row).toHaveTextContent('Similar name');
    expect(row).toHaveTextContent('Beta');
    expect(row).toHaveTextContent('confidence 0.91');
    expect(row).toHaveTextContent('score 0.91');
  });

  it('shows a radius match with its distance', () => {
    showMatches([listMatch({ method: 'radius', approximate: true, 'distance-meters': 1200 })]);

    expect(matchRow(IDS.match)).toHaveTextContent('1,200 m');
  });

  it('hides the matched value and the reason without pii:view', () => {
    showMatches(
      [
        maskedMatch(
          listMatch({
            status: 'dismissed',
            'dismissed-at': '2026-10-20T05:00:00.000Z',
            reason: 'x',
          }),
        ),
      ],
      { piiView: false },
    );

    const row = matchRow(IDS.match);
    expect(within(row).getAllByText('Hidden').length).toBeGreaterThanOrEqual(2);
    expect(row).not.toHaveTextContent('listed@example.test');
    expect(row).toHaveTextContent('Dismissed');
  });

  it('carries the DB-IP line beside a match on an IP location (C92.8)', () => {
    showMatches([
      listMatch({
        source: 'session.ip-point',
        method: 'radius',
        approximate: true,
        'distance-meters': 1200,
      }),
    ]);

    expect(screen.getByRole('link', { name: 'IP geolocation by DB-IP' })).toHaveAttribute(
      'href',
      'https://db-ip.com',
    );
  });

  it('carries no DB-IP line without an IP location', () => {
    showMatches([listMatch()]);

    expect(screen.queryByRole('link', { name: 'IP geolocation by DB-IP' })).toBeNull();
  });

  it('says when there is no match', () => {
    showMatches([]);

    expect(screen.getByText('No list match for this inquiry.')).toBeVisible();
  });

  it('dismisses an open match with a required reason, its error tied to the field', async () => {
    const dismiss = vi
      .fn<Action>()
      .mockReturnValueOnce(
        later({
          ok: false,
          problem: {
            title: 'Check the values you entered',
            detail: 'Some values are not valid.',
            errors: [{ pointer: '/data/attributes/reason', detail: 'Say why you dismiss it.' }],
          },
        }),
      )
      .mockReturnValueOnce(later({ ok: true, data: undefined }));
    showMatches([listMatch()], { dismiss });

    const opener = within(matchRow(IDS.match)).getByRole('button', {
      name: `Dismiss list match ${IDS.match}`,
    });
    await userEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Dismiss this list match?' });
    const reason = within(dialog).getByRole('textbox', { name: /Reason/ });
    expect(reason).toHaveFocus();
    expect(reason).toBeRequired();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }));

    expect(await within(dialog).findByText('Say why you dismiss it.')).toBeVisible();
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(reason).toHaveAccessibleDescription(/Say why you dismiss it\./);

    await userEvent.type(reason, 'Synthetic: a shared office address');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The list match was dismissed.');
    const sent = dismiss.mock.calls[1]?.[1];
    expect(sent?.get('list-match-id')).toBe(IDS.match);
    expect(sent?.get('reason')).toBe('Synthetic: a shared office address');
    expect(sent?.get('inquiry-id')).toBe(IDS.inquiry);
    expect(opener).toHaveFocus();
  });

  it('offers no dismissal without lists:write, or for a dismissed match', () => {
    showMatches(
      [
        listMatch(),
        ipRangeMatch({
          status: 'dismissed',
          'dismissed-at': '2026-10-20T05:00:00.000Z',
          reason: 'Synthetic',
        }),
      ],
      {
        canDismiss: true,
      },
    );
    expect(within(matchRow(IDS.ipMatch)).queryByRole('button')).toBeNull();
  });

  it('offers no dismissal at all without lists:write', () => {
    showMatches([listMatch()], { canDismiss: false });

    expect(screen.queryByRole('button', { name: /Dismiss/ })).toBeNull();
  });
});
