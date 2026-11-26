import type { InquiryResource } from '@openverify/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { inquiry } from '../../testing/lifecycle-fixtures';
import { NOT_COMPUTED_SIGNALS, computedSignals } from '../../testing/signals-fixtures';
import { InquirySignals } from './inquiry-signals';

type Attributes = InquiryResource['attributes'];

function show(attributes: Partial<Attributes>) {
  const { signals, 'signal-details': details } = inquiry(attributes).attributes;
  render(<InquirySignals signals={signals} details={details} />);
}

const layer = (name: string) => screen.getByRole('table', { name: `${name} signals` });
const row = (table: HTMLElement, label: string) => {
  const header = within(table).getByRole('rowheader', { name: new RegExp(label) });
  const found = header.closest('tr');
  if (found === null) throw new Error(`No row for ${label}`);
  return found;
};

describe('the Signals section (C90, C108)', () => {
  it('says "Not computed yet" while computed-at is null', () => {
    show(NOT_COMPUTED_SIGNALS);

    expect(screen.getByText(/Not computed yet/)).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says when the server serves no signals', () => {
    show({});

    expect(screen.getByText(/does not serve signals/)).toBeVisible();
  });

  it('groups the values by layer, each table with its headers', () => {
    show(computedSignals());

    for (const name of ['Behaviour', 'Network', 'Lists']) {
      expect(layer(name)).toBeVisible();
    }
    expect(
      within(layer('Network'))
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Signal', 'Value', 'Evidence', 'Reasons', 'Thresholds']);
  });

  it('reads a low bot score as "no automation artefacts found", with its beta badge, confidence and thresholds', () => {
    show(computedSignals());

    const bot = row(layer('Behaviour'), 'Bot score');
    expect(bot).toHaveTextContent('12 of 100: no automation artefacts found');
    expect(bot).toHaveTextContent('Beta');
    expect(bot).toHaveTextContent('confidence 0.40');
    expect(bot).toHaveTextContent('Low score confidence cap: 0.5');
    expect(bot).toHaveTextContent('inquiry/bot_score');
    expect(bot).not.toHaveTextContent(/human/i);
  });

  it('reads a null value as not evaluated with its reason, never "no"', () => {
    show(computedSignals());

    const behaviour = row(layer('Behaviour'), 'Behaviour threat level');
    expect(behaviour).toHaveTextContent('Not evaluated: too little behaviour was recorded');
    const tor = row(layer('Network'), 'Tor exit');
    expect(tor).toHaveTextContent('Not evaluated: the list does not cover IPv6 addresses');
    expect(within(tor).queryByText(/^No$/)).toBeNull();
  });

  it('reads a low threat level as "no listed risk found", with its limits', () => {
    show(computedSignals());

    const level = row(layer('Network'), 'Network threat level');
    expect(level).toHaveTextContent('Low: no listed risk found');
    expect(level).toHaveTextContent('the VPN list is not exhaustive');
    expect(level).not.toHaveTextContent(/safe/i);
  });

  it('carries the DB-IP line when a distance from IP locations shows', () => {
    show(computedSignals());

    expect(screen.getByRole('link', { name: 'IP geolocation by DB-IP' })).toHaveAttribute(
      'href',
      'https://db-ip.com',
    );
  });

  it('shows what the signals job did about review, with its cause and rules in words', () => {
    const { signals, 'signal-details': details } = computedSignals();
    show({
      signals,
      'signal-details': {
        ...details,
        'computed-at': details?.['computed-at'] ?? null,
        review: { cause: 'signal_rule', rules: [0, 2] },
      },
    });

    expect(screen.getByRole('note', { name: 'Signal review' })).toHaveTextContent(
      'A review rule matched a signal, so the inquiry was marked for review. Rules 1 and 3 of the template version matched.',
    );
  });

  it('shows no review note when the job recorded none', () => {
    show(computedSignals());

    expect(screen.queryByRole('note', { name: 'Signal review' })).toBeNull();
  });
});
