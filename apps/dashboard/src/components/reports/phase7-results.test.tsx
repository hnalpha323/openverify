import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { REPORT_RESULT_MEANS } from '../../lib/report-type-words';
import { report } from '../../testing/report-fixtures';
import { ReportTypeResults } from './report-results';
import { ReportSources } from './report-sources';

const LIST = 'lst_01M5CK3190XEVBM5ZXA76E1JSN';
const PENDING_LIST = 'lst_01M5CK3190XEVBM5ZXA76E1JS2';
const EMPTY_LIST = 'lst_01M5CK3190XEVBM5ZXA76E1JS3';

const errored = () =>
  report('custom-list', {
    attributes: {
      status: 'errored',
      'lists-searched': [LIST, PENDING_LIST, EMPTY_LIST],
      unscreened: [{ 'list-id': PENDING_LIST, reason: 'list_items_pending' }],
      'not-applicable': [{ 'list-id': EMPTY_LIST, reason: 'subject_has_no_value' }],
      errors: [{ code: 'list_unavailable', source: PENDING_LIST }],
    },
  });

describe('the custom-list report results (C106.2, C108)', () => {
  it('shows each matched item with its source, method, tier and value', () => {
    render(<ReportTypeResults report={report('custom-list')} state="visible" />);

    const table = screen.getByRole('table', { name: 'Items of Synthetic blocked emails' });
    const row = within(table)
      .getByRole('rowheader', { name: 'liea_01M5CK3190XEVBM5ZXA76E1JSN' })
      .closest('tr');
    expect(row).toHaveTextContent('Report query');
    expect(row).toHaveTextContent('Exact');
    expect(row).toHaveTextContent('R (an exact comparison)');
    expect(row).toHaveTextContent('listed@example.test');
    expect(screen.getByRole('heading', { name: /Synthetic blocked emails/ })).toHaveTextContent(
      'version 3',
    );
  });

  it('hides the compared values without pii:view', () => {
    render(<ReportTypeResults report={report('custom-list', { masked: true })} state="hidden" />);

    expect(screen.queryByText('listed@example.test')).toBeNull();
  });

  it('marks an H-tier item beta, with its confidence, score and approximate', () => {
    const golden = report('custom-list');
    const lists = golden.attributes[
      'matched-lists' as keyof typeof golden.attributes
    ] as unknown as {
      items: Record<string, unknown>[];
    }[];
    const fuzzy = lists.map((list) => ({
      ...list,
      items: list.items.map((item) => ({
        ...item,
        method: 'fuzzy_name',
        tier: 'H',
        confidence: 0.88,
        score: 0.88,
        approximate: true,
      })),
    }));
    render(
      <ReportTypeResults
        report={report('custom-list', { attributes: { 'matched-lists': fuzzy } })}
        state="visible"
      />,
    );

    const table = screen.getByRole('table', { name: 'Items of Synthetic blocked emails' });
    expect(table).toHaveTextContent('Similar name');
    expect(table).toHaveTextContent('Beta');
    expect(table).toHaveTextContent('confidence 0.88');
    expect(table).toHaveTextContent('score 0.88');
    expect(table).toHaveTextContent('approximate');
  });

  it('lists the lists searched, each unscreened list "not screened" with its reason, never "no match"', () => {
    render(<ReportTypeResults report={errored()} state="visible" />);

    const searched = screen.getByRole('list', { name: 'Lists searched' });
    expect(within(searched).getAllByRole('listitem')).toHaveLength(3);
    const screening = screen.getByRole('region', { name: 'Lists searched' });
    expect(within(screening).getByText(PENDING_LIST).closest('li')).toHaveTextContent(
      'Not screened: its items are still being prepared',
    );
    expect(within(screening).getByText(EMPTY_LIST).closest('li')).toHaveTextContent(
      'No value to compare',
    );
    expect(within(screening).getByText(LIST).closest('li')).toHaveTextContent('Screened');
    expect(screening).not.toHaveTextContent(/no match/i);
  });
});

describe('the custom-list provenance (C70.2, C106.2)', () => {
  it('shows each list read with its version, normaliser version, item count and screening time', () => {
    render(<ReportSources report={report('custom-list')} />);

    const row = within(screen.getByRole('table', { name: 'Sources' }))
      .getByRole('rowheader', { name: LIST })
      .closest('tr');
    expect(row).toHaveTextContent('Screened at version 3');
    expect(row).toHaveTextContent('normaliser lists-1');
    expect(row).toHaveTextContent('2 items');
    expect(row).toHaveTextContent('Oct 31, 2026');
    expect(row).toHaveTextContent('Your own list (no sync)');
  });
});

describe('the ip-address report results (C92.8, C106.1)', () => {
  it('carries the DB-IP line beside the IP location it shows', () => {
    render(<ReportTypeResults report={report('ip-address')} state="visible" />);

    expect(screen.getByRole('link', { name: 'IP geolocation by DB-IP' })).toHaveAttribute(
      'href',
      'https://db-ip.com',
    );
  });
});

/** A public IPv4 address checked against a fresh exit list, on a listed VPN and hosting network. */
const evaluated = (attributes: Record<string, unknown> = {}) =>
  report('ip-address', {
    attributes: {
      'tor-exit-node': 'CLEARED',
      'vpn-detected': true,
      'proxy-detected': false,
      'hosting-asn': true,
      flagged: true,
      'datacenter-ip': true,
      'service-type': 'DATACENTER',
      'country-code': 'US',
      'country-name': 'United States',
      city: 'Exampleville',
      region: 'Example Region',
      latitude: 40.5,
      longitude: -74.25,
      'client-address-source': 'trust-all',
      'unavailable-fields': [{ field: 'mobile-ip', reason: 'no_adapter' }],
      'field-details': {
        'tor-exit-node': { tier: 'R', reasons: [] },
        'datacenter-ip': { tier: 'R', reasons: ['provider_range'] },
        'vpn-detected': {
          tier: 'H',
          confidence: 0.6,
          reasons: ['vpn_asn', 'vpn_list_not_exhaustive'],
        },
        'proxy-detected': { tier: 'A', reasons: ['adapter_negative'] },
        'hosting-asn': { tier: 'H', confidence: 0.45, reasons: ['hosting_asn'] },
      },
      ...attributes,
    },
  });

/** The term and value of one field of the Fields section. */
const fieldOf = (label: string) => {
  const term = within(screen.getByRole('region', { name: 'Fields' })).getByText(label);
  const field = term.closest('div');
  expect(field).not.toBeNull();
  return field as HTMLElement;
};

describe('the ip-address fields in words, with their evidence (C106.1, C108, ADR 0006)', () => {
  it('reads CLEARED as what was checked, with its tier and no beta badge, never as the enum', () => {
    render(<ReportTypeResults report={evaluated()} state="visible" />);

    const tor = fieldOf('Tor exit node');
    expect(tor).toHaveTextContent('Checked against a fresh exit list: not found');
    expect(tor).toHaveTextContent('Tier R');
    expect(tor).not.toHaveTextContent('CLEARED');
    expect(tor).not.toHaveTextContent('Beta');
  });

  it('reads MATCHED as listed, with the reason the run recorded', () => {
    render(
      <ReportTypeResults
        report={evaluated({
          'tor-exit-node': 'MATCHED',
          'field-details': { 'tor-exit-node': { tier: 'R', reasons: ['tor_exit_listed'] } },
        })}
        state="visible"
      />,
    );

    const tor = fieldOf('Tor exit node');
    expect(tor).toHaveTextContent('Listed as a Tor exit');
    expect(tor).toHaveTextContent('listed as a Tor exit');
    expect(tor).not.toHaveTextContent('MATCHED');
  });

  it.each([
    ['VPN network', 'Tier H', 'confidence 0.60', 'the network (ASN) is a VPN network'],
    ['Hosting network', 'Tier H', 'confidence 0.45', 'the network (ASN) is a hosting network'],
  ])(
    'marks the H-tier %s beta, with its confidence and reasons',
    (label, tier, confidence, why) => {
      render(<ReportTypeResults report={evaluated()} state="visible" />);

      const field = fieldOf(label);
      expect(field).toHaveTextContent(tier);
      expect(field).toHaveTextContent('Beta');
      expect(field).toHaveTextContent(confidence);
      expect(field).toHaveTextContent(why);
    },
  );

  it('says the VPN list is not exhaustive beside the H-tier value', () => {
    render(<ReportTypeResults report={evaluated()} state="visible" />);

    expect(fieldOf('VPN network')).toHaveTextContent('the VPN list is not exhaustive');
  });

  it('reads an A-tier negative as "checked: not found" with its reason, never "No"', () => {
    render(<ReportTypeResults report={evaluated()} state="visible" />);

    const proxy = fieldOf('Proxy');
    expect(proxy).toHaveTextContent('Checked: not found');
    expect(proxy).toHaveTextContent('Tier A');
    expect(proxy).toHaveTextContent("the provider's data records it as not a proxy");
    expect(proxy).not.toHaveTextContent('Beta');
    expect(proxy).not.toHaveTextContent(/\bNo\b/);
  });

  it('keeps the tier and the reasons of a field the run could not answer, which stays unknown', () => {
    render(
      <ReportTypeResults
        report={evaluated({
          'vpn-detected': null,
          'hosting-asn': null,
          'datacenter-ip': null,
          'service-type': null,
          'proxy-detected': null,
          flagged: false,
          'unavailable-fields': [
            { field: 'vpn-detected', reason: 'not_in_known_ranges' },
            { field: 'proxy-detected', reason: 'provider_not_configured' },
          ],
          'field-details': {
            'vpn-detected': { tier: 'H', confidence: null, reasons: ['vpn_list_not_exhaustive'] },
            'proxy-detected': { tier: 'A', reasons: ['proxy_not_evaluated'] },
          },
        })}
        state="visible"
      />,
    );

    const vpn = fieldOf('VPN network');
    expect(vpn).toHaveTextContent('Unavailable: Not in the lists we hold');
    expect(vpn).toHaveTextContent('Tier H');
    expect(vpn).toHaveTextContent('Beta');
    expect(vpn).toHaveTextContent('the VPN list is not exhaustive');
    expect(vpn).not.toHaveTextContent('confidence');
    expect(fieldOf('Proxy')).toHaveTextContent('proxies were not evaluated (no provider)');
  });

  it('marks each IP-derived place and network approximate', () => {
    render(<ReportTypeResults report={evaluated()} state="visible" />);

    for (const label of [
      'Network provider',
      'Country',
      'Country name',
      'City',
      'Region',
      'Latitude',
      'Longitude',
    ]) {
      expect(fieldOf(label)).toHaveTextContent('approximate');
    }
  });

  it('marks no value it does not show approximate', () => {
    render(
      <ReportTypeResults
        report={report('ip-address', {
          masked: true,
          attributes: { city: 'Exampleville', 'unavailable-fields': [] },
        })}
        state="hidden"
      />,
    );

    expect(fieldOf('City')).not.toHaveTextContent('approximate');
  });

  it('never marks a field the run did not derive from the address approximate', () => {
    render(<ReportTypeResults report={evaluated()} state="visible" />);

    expect(fieldOf('Tor exit node')).not.toHaveTextContent('approximate');
    expect(fieldOf('Flagged')).not.toHaveTextContent('approximate');
  });

  it('words the service type and how the address was resolved', () => {
    render(<ReportTypeResults report={evaluated()} state="visible" />);

    expect(fieldOf('Service type')).toHaveTextContent('Datacenter (a provider’s published ranges)');
    expect(fieldOf('Service type')).not.toHaveTextContent('DATACENTER');
    expect(fieldOf('How the address was resolved')).not.toHaveTextContent('trust-all');
  });

  it('never reads an unflagged address as clean: an unavailable field stays unknown', () => {
    render(
      <ReportTypeResults
        report={evaluated({
          'tor-exit-node': 'CLEARED',
          'vpn-detected': null,
          'proxy-detected': null,
          'hosting-asn': null,
          'datacenter-ip': null,
          'service-type': null,
          flagged: false,
        })}
        state="visible"
      />,
    );

    const flagged = fieldOf('Flagged');
    expect(flagged).toHaveTextContent('Nothing found; an unavailable field is still unknown');
    expect(flagged).not.toHaveTextContent(/\bNo\b/);
  });

  it('words the error of a run that ended on a stale exit list', () => {
    render(
      <ReportTypeResults
        report={evaluated({
          status: 'errored',
          'tor-exit-node': null,
          errors: [{ code: 'list_stale', source: 'tor-exit-addresses' }],
          error: 'list_stale',
          'unavailable-fields': [{ field: 'tor-exit-node', reason: 'list_stale' }],
        })}
        state="visible"
      />,
    );

    const error = fieldOf('Error');
    expect(error).toHaveTextContent('List out of date');
    expect(error).not.toHaveTextContent('list_stale');
  });
});

describe('what a custom-list result means (docs/reports/custom-list.md)', () => {
  it('says "no match" only beside ready, as the page does', () => {
    expect(REPORT_RESULT_MEANS['custom-list'].always).toBe(
      'has-match: false means "no match" only beside ready, and a report is ready only when no selected list went unscreened.',
    );
  });
});
