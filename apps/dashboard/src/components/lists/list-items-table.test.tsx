import { render, screen, within } from '@testing-library/react';
import { LIST_KINDS, LIST_KIND_REGISTRY, type ListKind } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { LIST_IDS, seededSha256, listItem } from '../../testing/lists-fixtures';
import { ListItemsTable } from './list-items-table';

/** One item of each kind as the API serves it with `pii:view`; every value is fictional. */
const SHOWN: Readonly<Record<ListKind, Readonly<Record<string, unknown>>>> = {
  'browser-fingerprint': { value: seededSha256('browser'), 'key-id': 'k1k1k1k1k1k' },
  'device-fingerprint': { value: seededSha256('device'), 'key-id': 'k1k1k1k1k1k' },
  country: { 'country-code': 'NL' },
  'email-address': { value: 'shown@mail.example', 'match-type': 'domain' },
  face: { model: 'sface-2021dec', 'source-inquiry-id': LIST_IDS.inquiry },
  geolocation: { latitude: -40.5, longitude: -130.25, 'radius-meters': 5000 },
  'government-id-number': { 'id-number': 'X1234567', 'id-class': 'drivers_license' },
  field: { 'field-value': 'merchant-42' },
  'ip-address': { value: '192.0.2.0/24' },
  name: { 'name-first': 'Avery', 'name-last': 'Quillfeather' },
  'phone-number': { value: '+31201234567' },
  'selfie-background': { 'source-inquiry-id': LIST_IDS.inquiry },
  string: { value: 'synthetic-string' },
};

/** The same items masked: every PII value `null` (C97.6). */
const MASKED: Readonly<Record<ListKind, Readonly<Record<string, unknown>>>> = {
  ...SHOWN,
  'browser-fingerprint': { value: null, 'key-id': 'k1k1k1k1k1k' },
  'device-fingerprint': { value: null, 'key-id': 'k1k1k1k1k1k' },
  'email-address': { value: null, 'match-type': 'domain' },
  geolocation: { latitude: null, longitude: null, 'radius-meters': null },
  'government-id-number': { 'id-number': null, 'id-class': null },
  field: { 'field-value': null },
  'ip-address': { value: null },
  name: { 'name-first': null, 'name-last': null },
  'phone-number': { value: null },
  string: { value: null },
};

const itemOf = (kind: ListKind, attributes: Readonly<Record<string, unknown>>) =>
  listItem(kind, {
    id: `${LIST_KIND_REGISTRY[kind].itemPrefix}_01JC0000000000000000000009`,
    attributes,
  });

const valueCell = (kind: ListKind) => {
  const row = screen
    .getByRole('rowheader', {
      name: `${LIST_KIND_REGISTRY[kind].itemPrefix}_01JC0000000000000000000009`,
    })
    .closest('tr');
  if (row === null) {
    throw new Error(`no row for ${kind}`);
  }
  const [cell] = within(row).getAllByRole('cell');
  if (cell === undefined) {
    throw new Error(`no value cell for ${kind}`);
  }
  return cell;
};

describe('the items of each list kind (C97.1, C97.6)', () => {
  it('shows each kind’s value as the API served it', () => {
    render(
      <ListItemsTable
        items={LIST_KINDS.map((kind) => itemOf(kind, SHOWN[kind]))}
        listId={LIST_IDS.list}
        masked={false}
      />,
    );

    expect(valueCell('country')).toHaveTextContent('NL');
    expect(valueCell('email-address')).toHaveTextContent('shown@mail.exampleDomain');
    expect(valueCell('face')).toHaveTextContent(`From ${LIST_IDS.inquiry}Model sface-2021dec`);
    expect(valueCell('geolocation')).toHaveTextContent('-40.5, -130.25 within 5000 m');
    expect(valueCell('government-id-number')).toHaveTextContent('X1234567Drivers license');
    expect(valueCell('name')).toHaveTextContent('Avery Quillfeather');
    expect(valueCell('browser-fingerprint')).toHaveTextContent(seededSha256('browser'));
    expect(valueCell('browser-fingerprint')).toHaveTextContent('Key k1k1k1k1k1k');
    expect(valueCell('selfie-background')).toHaveTextContent(`From ${LIST_IDS.inquiry}`);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows Hidden for every masked value, and the class and country, which are not PII', () => {
    render(
      <ListItemsTable
        items={LIST_KINDS.map((kind) => itemOf(kind, MASKED[kind]))}
        listId={LIST_IDS.list}
        masked
      />,
    );

    for (const kind of LIST_KINDS.filter(
      (each) => !['country', 'face', 'selfie-background'].includes(each),
    )) {
      expect(valueCell(kind), kind).toHaveTextContent('Hidden');
    }
    expect(valueCell('government-id-number')).toHaveTextContent('Any class');
    expect(valueCell('country')).toHaveTextContent('NL');
    expect(screen.queryByText('X1234567')).toBeNull();
  });
});
