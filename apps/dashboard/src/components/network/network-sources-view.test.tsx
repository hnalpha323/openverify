import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SOURCE_SHA256, networkSources, seededHex } from '../../testing/signals-fixtures';
import { NetworkSourcesView } from './network-sources-view';

const show = (sources = networkSources()) => {
  render(<NetworkSourcesView sources={sources} />);
};

const sourceRow = (id: string) => {
  const found = within(screen.getByRole('table', { name: 'Network sources' }))
    .getByRole('rowheader', { name: new RegExp(id) })
    .closest('tr');
  if (found === null) throw new Error(`No row for ${id}`);
  return found;
};

describe('the network sources page (C92, C108)', () => {
  it('lists every source with its role, state, provenance and terms', () => {
    show();

    const table = screen.getByRole('table', { name: 'Network sources' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Source',
      'State',
      'Last check (UTC)',
      'Last applied sync',
      'Published (UTC)',
      'SHA-256',
      'Origin',
      'Last refusal',
      'Attribution and terms',
    ]);
    const sandbox = sourceRow('openverify-sandbox-network');
    expect(sandbox).toHaveTextContent('Sandbox');
    expect(sandbox).toHaveTextContent('Enabled');
    expect(sandbox).toHaveTextContent('Imported only');
    expect(sandbox).toHaveTextContent('Never stale (sandbox data)');
    expect(sandbox).toHaveTextContent(SOURCE_SHA256);
    expect(sandbox).toHaveTextContent('An import, not the publisher’s download');
    expect(sandbox).toHaveTextContent('Sync 3');
  });

  it('shows a stale source and its last refusal in words', () => {
    show();

    const country = sourceRow('dbip-country-lite');
    expect(country).toHaveTextContent('Stale: older than 1,080 hours');
    expect(country).toHaveTextContent('Refused: too much removed at once');
    expect(country).toHaveTextContent('2 failed checks');
    expect(country).toHaveTextContent('From the publisher');
  });

  it('shows the attribution with its link-back, and the terms note with its link', () => {
    show();

    const country = sourceRow('dbip-country-lite');
    expect(within(country).getByRole('link', { name: 'IP geolocation by DB-IP' })).toHaveAttribute(
      'href',
      'https://db-ip.com',
    );
    expect(country).toHaveTextContent('Synthetic terms note');
    expect(within(country).getByRole('link', { name: 'Terms' })).toHaveAttribute(
      'href',
      'https://terms.example.org/network',
    );
  });

  it('says a source never checked, and one this process cannot configure', () => {
    show();

    const tor = sourceRow('tor-exit-addresses');
    expect(tor).toHaveTextContent('Never checked');
    expect(tor).toHaveTextContent('Not configured: this process has no object storage');
    expect(tor).not.toHaveTextContent(/fresh/i);
  });

  it('lists the recent syncs with their outcomes in words', () => {
    show();

    const syncs = screen.getByRole('table', { name: 'Recent syncs' });
    const refused = within(syncs).getByRole('rowheader', { name: '8' }).closest('tr');
    expect(refused).toHaveTextContent('Refused: too much removed at once');
    expect(refused).toHaveTextContent('dbip-country-lite');
    expect(refused).toHaveTextContent('Job');
    const applied = within(syncs).getByRole('rowheader', { name: '3' }).closest('tr');
    expect(applied).toHaveTextContent('Applied');
    expect(applied).toHaveTextContent('Allow mass addition');
    expect(applied).toHaveTextContent('Seed');
  });

  it('shows the pinned ASN seeds with their commit and counts', () => {
    show();

    const seeds = screen.getByRole('region', { name: 'Pinned ASN seeds' });
    expect(seeds).toHaveTextContent('Loaded');
    expect(seeds).toHaveTextContent('933 hosting networks');
    expect(seeds).toHaveTextContent('16 VPN networks');
    expect(seeds).toHaveTextContent(seededHex('dashboard-signals/seed-commit').slice(0, 40));
    expect(seeds).toHaveTextContent(seededHex('dashboard-signals/seed-datacenter'));
  });

  it('says when the seeds are missing, and what that leaves unevaluated', () => {
    show(
      networkSources({
        'asn-seeds': {
          status: 'missing',
          files: [],
          'hosting-asns': null,
          'vpn-asns': null,
          seeds: [],
        },
      }),
    );

    expect(screen.getByRole('region', { name: 'Pinned ASN seeds' })).toHaveTextContent(
      'Missing: the VPN and hosting flags read not evaluated until the seeds are fetched',
    );
  });

  it('says when no sync ran', () => {
    show(networkSources({ 'recent-syncs': [] }));

    expect(screen.getByText('No sync has run yet.')).toBeVisible();
  });
});
