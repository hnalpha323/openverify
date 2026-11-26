import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Report } from '../../lib/report-documents';
import { report } from '../../testing/report-fixtures';
import type { PiiState } from './report-parts';
import { ReportTypeResults } from './report-results';

const show = (subject: Report, state: PiiState = 'visible') =>
  render(<ReportTypeResults report={subject} state={state} />);
const region = (name: string) => screen.getByRole('region', { name });
const term = (scope: HTMLElement, name: string) =>
  within(scope).getByText(name, { selector: 'dt' }).nextElementSibling as HTMLElement;
const rowOf = (scope: HTMLElement, name: string) =>
  within(within(scope).getByRole('rowheader', { name }).closest('tr') as HTMLElement);

describe('what a watchlist and a business watchlist found (C79.1, C79.2)', () => {
  it('lists each matched list with its entries: names, alias, birth dates, countries, programmes and score', () => {
    show(report('watchlist'));

    const lists = region('Matched lists');
    expect(
      within(lists).getByRole('heading', { name: /OpenVerify sandbox sanctions list/ }),
    ).toBeVisible();
    const row = rowOf(lists, 'QUILLFEATHER, Avery Sandbox');
    expect(row.getByText('Primary name')).toBeVisible();
    expect(row.getByText('1980-04-12')).toBeVisible();
    expect(row.getByText('GB')).toBeVisible();
    expect(row.getByText('SANDBOX-PROGRAM-1')).toBeVisible();
    expect(row.getByText('0.93')).toBeVisible();
  });

  it('lists a business entry’s kind and identifiers, and the lists searched', () => {
    show(report('business-watchlist'));

    const lists = region('Matched lists');
    const row = rowOf(lists, 'Sandbox Sanctioned Holdings Ltd');
    expect(row.getByText('Entity')).toBeVisible();
    expect(row.getByText('LEI 5299000SANDBOXLEI047')).toBeVisible();
    expect(term(lists, 'Lists searched')).toHaveTextContent('openverify-sandbox');
  });

  it('names the other lists an entry is on, with each one’s programme, never as an SDN-level block (owner decision 9)', () => {
    show(report('business-watchlist'));

    const lists = region('Matched lists');
    const table = within(lists).getByRole('table', {
      name: 'Entries of OpenVerify sandbox sanctions list',
    });
    const row = rowOf(lists, 'Sandbox Sanctioned Holdings Ltd');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    const cell = row.getAllByRole('cell')[headers.indexOf('Other lists') - 1];
    expect(cell).toHaveTextContent('Synthetic Sectoral List (programme SYNTHETIC-SECTORAL)');
    expect(lists).toHaveTextContent(
      'Other lists names each list of the publisher other than its main one (for OFAC, the lists other than the SDN List) that holds the entry, with the programme tied to it where the publisher ties one. A listing on those lists alone is not an SDN-level block: its measures are those of the list named.',
    );
  });

  it('shows an entry listed only on a non-blocking list with that list, and a membership without a programme as such (owner decision 9)', () => {
    const golden = report('watchlist');
    const [list] = (golden.attributes as { 'matched-lists': Record<string, unknown>[] })[
      'matched-lists'
    ];
    const [entity] = (list as { entities: Record<string, unknown>[] }).entities;
    show(
      report('watchlist', {
        attributes: {
          'matched-lists': [
            {
              ...list,
              entities: [
                {
                  ...entity,
                  'list-memberships': [
                    { list: 'Synthetic Sectoral List', program: null },
                    { list: 'Synthetic Menu-Based List', program: null },
                  ],
                },
              ],
            },
          ],
        },
      }),
    );

    const row = rowOf(region('Matched lists'), 'QUILLFEATHER, Avery Sandbox');
    expect(
      row.getByText(
        'Synthetic Sectoral List (no programme tied to this list), Synthetic Menu-Based List (no programme tied to this list)',
      ),
    ).toBeVisible();
    expect(row.queryByText(/SDN/)).toBeNull();
  });

  it('says None where an entry is on no other list', () => {
    show(report('watchlist'));

    const lists = region('Matched lists');
    const table = within(lists).getByRole('table', {
      name: 'Entries of OpenVerify sandbox sanctions list',
    });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    const row = rowOf(lists, 'QUILLFEATHER, Avery Sandbox');
    expect(row.getAllByRole('cell')[headers.indexOf('Other lists') - 1]).toHaveTextContent('None');
  });

  it('hides the matched lists from an operator without pii:view', () => {
    show(report('watchlist', { masked: true }), 'hidden');
    expect(within(region('Matched lists')).getByText('Hidden')).toBeVisible();
    expect(screen.queryByText('QUILLFEATHER, Avery Sandbox')).toBeNull();
  });
});

describe('what a crypto address watchlist found (C79.3, C83)', () => {
  it('lists each listed address with its ticker and chain, the address format and the exposure', () => {
    show(report('crypto-address-watchlist'));

    const listed = region('Listed crypto addresses');
    expect(within(listed).getByRole('heading', { name: 'Sandbox Ledger Services' })).toBeVisible();
    const row = rowOf(listed, '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
    expect(row.getByText('ETH')).toBeVisible();
    expect(row.getByText('eip155:1')).toBeVisible();
    expect(term(listed, 'Address format')).toHaveTextContent('EVM');
    expect(term(listed, 'Exposure')).toHaveTextContent(
      'Unavailable: No provider is bound for it in this environment.',
    );
  });

  it('shows an exposure block, a risk score never synthesised', () => {
    show(
      report('crypto-address-watchlist', {
        attributes: {
          exposure: {
            'direct-sanctioned': false,
            exposures: [{ category: 'sanctioned_entity', share: 0.25, hops: 1 }],
            'risk-score': null,
          },
          'unavailable-fields': [],
        },
      }),
    );

    const exposure = term(region('Listed crypto addresses'), 'Exposure');
    expect(exposure).toHaveTextContent('Directly sanctioned: No');
    expect(exposure).toHaveTextContent('sanctioned_entity: 25% at 1 hop or more');
    expect(exposure).toHaveTextContent('Risk score: not computed (no score is synthesised)');
  });
});

describe('the other lists of a listed crypto address (owner decision 9)', () => {
  it('names each other list the entry is on beside its addresses', () => {
    const golden = report('crypto-address-watchlist');
    const [list] = (golden.attributes as { result: Record<string, unknown>[] }).result;
    const [entity] = (list as { entities: Record<string, unknown>[] }).entities;
    show(
      report('crypto-address-watchlist', {
        attributes: {
          result: [
            {
              ...list,
              entities: [
                {
                  ...entity,
                  'list-memberships': [
                    { list: 'Synthetic Sectoral List', program: 'SYNTHETIC-SECTORAL' },
                  ],
                },
              ],
            },
          ],
        },
      }),
    );

    const listed = region('Listed crypto addresses');
    expect(term(listed, 'Other lists of Sandbox Ledger Services')).toHaveTextContent(
      'Synthetic Sectoral List (programme SYNTHETIC-SECTORAL)',
    );
    expect(listed).toHaveTextContent('is not an SDN-level block');
  });
});

describe('what a PEP report found (C80.5)', () => {
  it('shows each person with their positions and relatives, and Wikidata sources as plain links', () => {
    show(report('politically-exposed-person'));

    const people = region('Politically exposed persons');
    const person = within(people).getByRole('article', { name: 'Marlowe Testerton' });
    expect(term(person, 'Type')).toHaveTextContent('Politically exposed person');
    expect(term(person, 'Country')).toHaveTextContent('GB');
    expect(term(person, 'Birth dates')).toHaveTextContent('1971');
    const positions = within(person).getByRole('table', { name: 'Positions of Marlowe Testerton' });
    const row = rowOf(positions, 'Minister of Synthetic Affairs');
    expect(row.getByText('1')).toBeVisible();
    expect(row.getByText('2024-01-15')).toBeVisible();
    expect(row.getByText('Yes')).toBeVisible();
    expect(term(person, 'Relatives')).toHaveTextContent('None');
    const source = within(person).getByRole('link', { name: /Q-test-1001/ });
    expect(source).toHaveAttribute('href', 'https://pep.sandbox.example/Q-test-1001');
    expect(source).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  });

  it('names a relative and how they relate', () => {
    const golden = report('politically-exposed-person');
    const [entity] = (golden.attributes as { result: Record<string, unknown>[] }).result;
    show(
      report('politically-exposed-person', {
        attributes: {
          result: [
            {
              ...entity,
              'pep-type': 'relative',
              positions: [],
              associates: [{ name: 'Imogen Testerton', relationship: 'spouse' }],
            },
          ],
        },
      }),
    );

    const person = within(region('Politically exposed persons')).getByRole('article', {
      name: 'Marlowe Testerton',
    });
    expect(term(person, 'Type')).toHaveTextContent('Relative of a politically exposed person');
    expect(term(person, 'Relatives')).toHaveTextContent('Imogen Testerton (Spouse)');
  });

  it('says the class of the PEP a relative relates to, from the relative’s own record (owner decision 9)', () => {
    const golden = report('politically-exposed-person');
    const [entity] = (golden.attributes as { result: Record<string, unknown>[] }).result;
    show(
      report('politically-exposed-person', {
        attributes: {
          result: [
            {
              ...entity,
              'pep-type': 'relative',
              positions: [],
              associates: [{ name: 'Imogen Testerton', relationship: 'spouse' }],
              'relative-of-class': 2,
            },
          ],
        },
      }),
    );

    const person = within(region('Politically exposed persons')).getByRole('article', {
      name: 'Marlowe Testerton',
    });
    expect(term(person, 'Class of the related PEP')).toHaveTextContent(
      'Class 2: the most senior class of the PEPs this relative relates to',
    );
  });

  it('says a relative’s class is not recorded when the record does not carry it, and gives a holder none (owner decision 9)', () => {
    const golden = report('politically-exposed-person');
    const [entity] = (golden.attributes as { result: Record<string, unknown>[] }).result;
    show(
      report('politically-exposed-person', {
        attributes: {
          result: [
            { ...entity, 'entity-id': 'Q-test-1002', 'pep-type': 'relative', positions: [] },
            { ...entity, 'entity-id': 'Q-test-1001', name: 'Holder Testerton' },
          ],
        },
      }),
    );

    const people = region('Politically exposed persons');
    const relative = within(people).getByRole('article', { name: 'Marlowe Testerton' });
    expect(term(relative, 'Class of the related PEP')).toHaveTextContent(
      'Not recorded: the list was synced before relatives carried their class',
    );
    const holder = within(people).getByRole('article', { name: 'Holder Testerton' });
    expect(within(holder).queryByText('Class of the related PEP')).toBeNull();
  });
});

describe('what an adverse media report found (C81)', () => {
  it('lists each article as a plain link, never fetched, previewed or embedded, with its confidence and beta stage', () => {
    show(report('adverse-media'));

    const articles = region('Articles');
    const link = within(articles).getByRole('link', {
      name: /avery sandbox media named in synthetic embezzlement report 1/,
    });
    expect(link).toHaveAttribute('href', 'https://sandbox-news.example/articles/synthetic-1');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(articles.querySelector('img, iframe, object, embed, video')).toBeNull();
    const [article] = within(articles).getAllByRole('listitem');
    if (article === undefined) {
      throw new Error('no article');
    }
    expect(term(article, 'Domain')).toHaveTextContent('sandbox-news.example');
    expect(term(article, 'Seen (UTC)')).toHaveTextContent('Oct 26, 2026, 12:00 PM');
    expect(term(article, 'Language')).toHaveTextContent('English');
    expect(term(article, 'Categories')).toHaveTextContent('Financial crime');
    expect(term(article, 'Confidence')).toHaveTextContent('0.60');
    expect(within(term(article, 'Confidence')).getByText('Beta')).toHaveAttribute(
      'data-stage',
      'beta',
    );
    expect(articles).toHaveTextContent(
      'Synthetic articles from the OpenVerify sandbox provider; no news service was asked.',
    );
  });

  it('hides the articles, titles and all, from an operator without pii:view', () => {
    show(report('adverse-media', { masked: true }), 'hidden');

    expect(within(region('Articles')).getByText('Hidden')).toBeVisible();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('what an email, phone or address report computed (C82)', () => {
  it('shows the email fields, the reputation with its confidence, reasons and beta stage, and each unavailable field explained', () => {
    show(report('email-address'));

    const fields = region('Fields');
    expect(term(fields, 'Domain')).toHaveTextContent('example.test');
    expect(term(fields, 'Domain kind')).toHaveTextContent('Custom domain');
    expect(term(fields, 'Domain accepts mail')).toHaveTextContent('Yes');
    const reputation = term(fields, 'Reputation');
    expect(reputation).toHaveTextContent('Medium');
    expect(reputation).toHaveTextContent('Confidence 0.50');
    expect(reputation).toHaveTextContent('A breach in the last 12 months');
    expect(within(reputation).getByText('Beta')).toBeVisible();
    expect(term(fields, 'Domain age (days)')).toHaveTextContent(
      'Unavailable: The rule could not decide it.',
    );
    expect(term(fields, 'Deliverable')).toHaveTextContent(
      'Unavailable: Only a report made when an inquiry completed can say this, and this one was not.',
    );
  });

  it('shows the domain kind where the masked domain is hidden (P15)', () => {
    show(report('email-address', { masked: true }), 'hidden');

    const fields = region('Fields');
    expect(within(term(fields, 'Domain')).getByText('Hidden')).toBeVisible();
    expect(term(fields, 'Domain kind')).toHaveTextContent('Custom domain');
    expect(fields).not.toHaveTextContent('example.test');
  });

  it('shows the phone line types, the risk with its recommendation, confidence and reasons, and the SIM swap', () => {
    show(report('phone-number'));

    const fields = region('Fields');
    expect(term(fields, 'Line type')).toHaveTextContent('Mobile');
    expect(term(fields, 'Numbering plan type')).toHaveTextContent('Fixed line or mobile');
    const risk = term(fields, 'Risk level');
    expect(risk).toHaveTextContent('High');
    expect(risk).toHaveTextContent('Confidence 0.80');
    expect(risk).toHaveTextContent('A SIM swap in the last 24 hours');
    expect(term(fields, 'Recommendation')).toHaveTextContent('Block');
    expect(term(fields, 'Risk score')).toHaveTextContent(
      'Unavailable: No documented method computes it.',
    );
  });

  it('shows the address as normalised, the offline checks and the provider fields', () => {
    show(report('address-lookup'));

    const fields = region('Fields');
    expect(term(fields, 'Street address')).toHaveTextContent('1002 Placeholder Avenue');
    expect(term(fields, 'Postal code valid')).toHaveTextContent('Yes');
    expect(term(fields, 'Deliverability')).toHaveTextContent('Not confirmed');
    expect(term(fields, 'Designators')).toHaveTextContent('None');
    expect(term(fields, 'County')).toHaveTextContent('Unavailable: The rule could not decide it.');
  });
});
