import { GOVERNMENT_ID_EXTRACTION_ATTRIBUTES } from '@openverify/contracts';
import { EXTRACTION_SOURCES } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXTRACTION_FIELD_LABELS, EXTRACTION_SOURCE_LABELS } from '../lib/labels';
import { governmentIdVerification } from '../testing/lifecycle-fixtures';
import { ExtractionTable, type ExtractionState } from './extraction-table';

/** A synthetic holder of the fictional issuer Utopia, read from the MRZ and the visual zone. */
const EXTRACTED = {
  'name-first': 'NORA',
  'name-last': 'CALDERWOOD',
  birthdate: '1988-03-21',
  sex: 'F',
  nationality: 'UTO',
  'identification-number': 'UT4829163',
  'issue-date': '2024-05-06',
  'expiration-date': '2034-05-05',
  'issuing-authority-code': 'UTO',
  'address-street-1': '27 HARBOUR ROAD, UTOPIA CITY',
} as const;

const SOURCES = {
  'name-last': ['mrz', 'viz'],
  birthdate: ['mrz', 'viz'],
  'address-street-1': ['viz'],
} as const;

/** Every attribute as the API sends it: the extracted ones, `null` for the rest. */
function attributes(values: Partial<Record<string, string | null>>) {
  return Object.fromEntries(
    GOVERNMENT_ID_EXTRACTION_ATTRIBUTES.map((field) => [field, values[field] ?? null]),
  );
}

function renderTable(
  state: ExtractionState,
  values: Partial<Record<string, string | null>> = state === 'visible' ? EXTRACTED : {},
  sources: Record<string, readonly string[]> | null = SOURCES,
) {
  return render(
    <ExtractionTable
      verification={governmentIdVerification({
        ...attributes(values),
        'extraction-sources': sources,
      })}
      state={state}
    />,
  );
}

const table = () => screen.getByRole('table', { name: 'Extracted fields' });

function cells(label: string) {
  const row = within(table()).getByRole('rowheader', { name: label }).closest('tr');
  if (row === null) throw new Error(`No row for ${label}`);
  const [value, sources] = within(row).getAllByRole('cell');
  if (value === undefined || sources === undefined) throw new Error(`No cells for ${label}`);
  return { value, sources };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the extraction labels (C31.5)', () => {
  it.each(GOVERNMENT_ID_EXTRACTION_ATTRIBUTES)('says %s in words', (field) => {
    expect(EXTRACTION_FIELD_LABELS[field]).toMatch(/^[A-Z][a-z]/);
  });

  it('gives every attribute its own label', () => {
    const labels = GOVERNMENT_ID_EXTRACTION_ATTRIBUTES.map(
      (field) => EXTRACTION_FIELD_LABELS[field],
    );
    expect(new Set(labels).size).toBe(GOVERNMENT_ID_EXTRACTION_ATTRIBUTES.length);
  });

  it.each(EXTRACTION_SOURCES)('says the source %s in words', (source) => {
    expect(EXTRACTION_SOURCE_LABELS[source]).toMatch(/^[A-Z][A-Za-z -]+$/);
  });
});

describe('ExtractionTable (C31.5, C31.6, C37)', () => {
  it('lists every extraction attribute of the contract, by its label, in a table with headers', () => {
    renderTable('visible');

    expect(
      within(table())
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Field', 'Value', 'Read from']);
    expect(
      within(table())
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toEqual(GOVERNMENT_ID_EXTRACTION_ATTRIBUTES.map((field) => EXTRACTION_FIELD_LABELS[field]));
  });

  it('shows each value the API sent, and a field it did not read as missing', () => {
    renderTable('visible');

    expect(cells('Last name').value).toHaveTextContent(/^CALDERWOOD$/);
    expect(cells('Document number').value).toHaveTextContent(/^UT4829163$/);
    expect(cells('Street address').value).toHaveTextContent('27 HARBOUR ROAD, UTOPIA CITY');
    expect(cells('Middle name').value).toHaveTextContent(/^—None$/);
  });

  it('shows dates as the ISO dates the API sent, with no time-zone shift', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    renderTable('visible');

    expect(cells('Date of birth').value).toHaveTextContent(/^1988-03-21$/);
    expect(cells('Issue date').value).toHaveTextContent(/^2024-05-06$/);
    expect(cells('Expiry date').value).toHaveTextContent(/^2034-05-05$/);
  });

  it('names the sources that agreed on each field, in words', () => {
    renderTable('visible');

    expect(cells('Last name').sources).toHaveTextContent(/^Machine-readable zone, Visual zone$/);
    expect(cells('Street address').sources).toHaveTextContent(/^Visual zone$/);
    expect(cells('First name').sources).toHaveTextContent(/^—None$/);
  });

  it('shows every value as "Hidden", with why, to an operator the API masked them for', () => {
    renderTable('hidden');

    const hidden = within(table()).getAllByText('Hidden', { exact: true });
    expect(hidden).toHaveLength(GOVERNMENT_ID_EXTRACTION_ATTRIBUTES.length);
    for (const value of hidden) {
      expect(value).toHaveAccessibleDescription(
        'Your role cannot see personal data (the pii:view permission).',
      );
    }
    // The sources name fields only, so the API does not mask them (C31.5).
    expect(cells('Last name').sources).toHaveTextContent('Machine-readable zone, Visual zone');
  });

  it('shows every value as "Redacted" once the inquiry was redacted', () => {
    renderTable('redacted');

    expect(within(table()).getAllByText('Redacted', { exact: true })).toHaveLength(
      GOVERNMENT_ID_EXTRACTION_ATTRIBUTES.length,
    );
  });

  it('says nothing was read when the verification has no extraction', () => {
    renderTable('visible', {}, null);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Nothing was read from this document.')).toBeVisible();
  });
});
