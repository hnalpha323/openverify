/**
 * C62.10, C66: the read-only chip trust store: whether a production environment can publish an
 * NFC step; each source with whether it is enabled, its last sync, the list's signing time and
 * SHA-256, its anchors and its latest sync's outcome in words; the anchors per country; the
 * withdrawn anchors; each CRL's freshness; the sandbox anchors, labelled sandbox-only; and
 * whether the worker refreshes the store and ICAO PKD CRLs are fetched. Nothing in it is personal
 * data.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { emptyTrustStore, trustAnchorsDocument } from '../../testing/fixtures/government-id-nfc';
import { TrustStoreView } from './trust-store-view';

const table = (name: string) => screen.getByRole('table', { name });

function headers(scope: HTMLElement): (string | null)[] {
  return within(scope)
    .getAllByRole('columnheader')
    .map((header) => header.textContent);
}

function row(scope: HTMLElement, name: string | RegExp): HTMLElement {
  const found = within(scope).getByRole('rowheader', { name }).closest('tr');
  if (found === null) throw new Error(`No row ${String(name)}`);
  return found;
}

const cells = (tableRow: HTMLElement) =>
  within(tableRow)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

function term(scope: HTMLElement, name: string): HTMLElement {
  const dd = within(scope).getByText(name, { selector: 'dt' }).nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`No value for ${name}`);
  return dd;
}

const section = (name: string) => screen.getByRole('region', { name });

describe('TrustStoreView (C62.10, C66)', () => {
  it('says whether a production environment can publish an NFC step, and when the answer was made', () => {
    const { unmount } = render(<TrustStoreView store={trustAnchorsDocument()} />);
    const summary = section('Summary');
    expect(term(summary, 'Production anchor')).toHaveTextContent(/^Yes/);
    expect(term(summary, 'Generated (UTC)').querySelector('time')).toHaveAttribute(
      'datetime',
      '2026-10-23T12:00:00.000Z',
    );
    unmount();

    render(<TrustStoreView store={trustAnchorsDocument({ 'has-production-anchor': false })} />);
    const production = term(section('Summary'), 'Production anchor');
    expect(production).toHaveTextContent(/^No/);
    expect(production).toHaveTextContent('provider_not_configured');
  });

  // Workflow 5C review K13 (owner decision 6 after Workflow 5B): the API now reports both.
  it('says whether the worker refreshes the store and whether ICAO PKD CRLs are fetched', () => {
    const { unmount } = render(<TrustStoreView store={trustAnchorsDocument()} />);
    const summary = section('Summary');
    expect(term(summary, 'Store refresh')).toHaveTextContent(/^On/);
    expect(term(summary, 'Store refresh')).toHaveTextContent('OPENVERIFY_TRUST_ANCHOR_REFRESH');
    expect(term(summary, 'ICAO PKD CRLs')).toHaveTextContent(/^Not fetched/);
    expect(term(summary, 'ICAO PKD CRLs')).toHaveTextContent('OPENVERIFY_NFC_ALLOW_ICAO_CRLS');
    expect(summary).not.toHaveTextContent(/does not report/);
    unmount();

    render(
      <TrustStoreView
        store={trustAnchorsDocument({
          settings: { 'refresh-enabled': false, 'icao-crls-allowed': true },
        })}
      />,
    );
    expect(term(section('Summary'), 'Store refresh')).toHaveTextContent(/^Off/);
    expect(term(section('Summary'), 'ICAO PKD CRLs')).toHaveTextContent(/^Fetched/);
  });

  it('lists each source with its sync, its list and its latest attempt in words', () => {
    render(<TrustStoreView store={trustAnchorsDocument()} />);

    const sources = table('Trust anchor sources');
    expect(headers(sources)).toEqual([
      'Source',
      'Enabled',
      'Last synced (UTC)',
      'List signed (UTC)',
      'List SHA-256',
      'Anchors listed',
      'Latest sync',
    ]);
    const bsi = row(sources, /bsi-de/);
    expect(bsi).toHaveTextContent('Germany’s master list (BSI)');
    const [enabled, synced, signed, sha, anchors, latest] = cells(bsi);
    expect(enabled).toBe('Enabled');
    expect(synced).toBe('Oct 23, 2026, 3:00 AM');
    expect(signed).toBe('Oct 1, 2026, 8:30 AM');
    expect(sha).toBe('c1de5293030ec1f27fa867c5ab6004814d5d9e2fa6c60411927ddda7155ae964');
    expect(anchors).toBe('3');
    expect(latest).toContain('Accepted');
    expect(latest).toContain('3 seen, 1 withdrawn, 2 CRLs updated');

    const [disabled, never, unsigned, noSha, none, noSync] = cells(row(sources, /npkd-nl/));
    expect([disabled, never, unsigned, noSha, none, noSync]).toEqual([
      'Disabled',
      'Never',
      'None',
      'None',
      '0',
      'Never synced',
    ]);
  });

  it('says why a sync was refused', () => {
    const store = trustAnchorsDocument();
    const [bsi] = store.sources;
    if (bsi?.['last-sync'] == null) throw new Error('the golden BSI source has a sync');
    render(
      <TrustStoreView
        store={{
          ...store,
          sources: [
            {
              ...bsi,
              'last-sync': {
                ...bsi['last-sync'],
                outcome: 'refused',
                reason: 'list_signing_time_rollback',
              },
            },
          ],
        }}
      />,
    );

    const latest = cells(row(table('Trust anchor sources'), /bsi-de/)).at(-1);
    expect(latest).toContain('Refused');
    expect(latest).toContain('Older than the list already held (rollback)');
  });

  it('lists the anchors per country by name', () => {
    render(<TrustStoreView store={trustAnchorsDocument()} />);

    const countries = table('Anchors per country');
    expect(headers(countries)).toEqual([
      'Country',
      'Usable anchors',
      'Link certificates',
      'Withdrawn anchors',
      'Next expiry (UTC)',
    ]);
    expect(row(countries, /Germany/)).toHaveTextContent('DE');
    expect(cells(row(countries, /Germany/))).toEqual(['2', '1', '1', 'Mar 1, 2031, 12:00 AM']);
  });

  it('lists the withdrawn anchors, and says when their sources were only disabled', () => {
    const store = trustAnchorsDocument();
    const [withdrawn] = store['withdrawn-anchors'];
    if (withdrawn === undefined) throw new Error('the golden store has a withdrawn anchor');
    render(
      <TrustStoreView
        store={{
          ...store,
          'withdrawn-anchors': [
            withdrawn,
            {
              ...withdrawn,
              id: 'a'.repeat(64),
              'subject-dn': 'CN=Synthetic CSCA DE 2011,O=OpenVerify Fixtures,C=DE',
              'withdrawn-at': null,
            },
          ],
        }}
      />,
    );

    const anchors = table('Withdrawn anchors');
    expect(headers(anchors)).toEqual(['Subject', 'Country', 'SHA-256', 'Withdrawn (UTC)']);
    const [first, second] = within(anchors).getAllByRole('rowheader');
    expect(first).toHaveTextContent('CN=Synthetic CSCA DE 2014,O=OpenVerify Fixtures,C=DE');
    expect(cells(row(anchors, /Synthetic CSCA DE 2014/)).at(-1)).toBe('Oct 23, 2026, 3:00 AM');
    expect(second?.closest('tr')).toHaveTextContent('Its sources were disabled');
  });

  it('shows each CRL’s freshness in words, never by colour alone', () => {
    render(<TrustStoreView store={trustAnchorsDocument()} />);

    const crls = table('Certificate revocation lists');
    expect(headers(crls)).toEqual([
      'Issuer country',
      'Issuer key ID',
      'This update (UTC)',
      'Next update (UTC)',
      'Fetched (UTC)',
      'Freshness',
    ]);
    expect(cells(row(crls, /Germany/)).at(-1)).toBe('Current');
    expect(cells(row(crls, /France/)).at(-1)).toBe('Expired');
  });

  it('labels the sandbox anchors sandbox-only, never trusted for production', () => {
    render(<TrustStoreView store={trustAnchorsDocument()} />);

    const sandbox = section('Sandbox anchors');
    expect(sandbox).toHaveTextContent(/Sandbox-only anchor/);
    expect(sandbox).toHaveTextContent(/never trusted in a production environment/);
    const anchors = within(sandbox).getByRole('table', { name: 'Sandbox-only anchors' });
    expect(headers(anchors)).toEqual([
      'Country',
      'SHA-256',
      'Valid from (UTC)',
      'Valid until (UTC)',
      'CRL next update (UTC)',
    ]);
    expect(row(anchors, /Utopia \(test issuer\)/)).toHaveTextContent(
      '481be764d6a4b169b42741cffa31be6941613d10b83c2933685e6e03f658a66e',
    );
  });

  it('says what an empty store holds', () => {
    render(<TrustStoreView store={emptyTrustStore()} />);

    expect(table('Trust anchor sources')).toHaveTextContent('No source has been recorded yet.');
    expect(table('Anchors per country')).toHaveTextContent('No usable anchor.');
    expect(table('Withdrawn anchors')).toHaveTextContent('No anchor has been withdrawn.');
    expect(table('Certificate revocation lists')).toHaveTextContent('No CRL is held.');
    expect(table('Sandbox-only anchors')).toHaveTextContent('No sandbox anchor.');
  });
});
