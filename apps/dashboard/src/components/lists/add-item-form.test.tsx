import { render, screen, within } from '@testing-library/react';
import { LIST_KINDS, type ListKind } from '@openverify/core';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../toasts';
import { AddItemForm } from './add-item-form';

/** The labelled fields each kind's form asks for (C97.1). */
const FIELDS: Readonly<Record<ListKind, readonly string[]>> = {
  'browser-fingerprint': ['Fingerprint'],
  'device-fingerprint': ['Fingerprint'],
  country: ['Country code'],
  'email-address': ['Email address'],
  face: ['Inquiry ID'],
  geolocation: ['Latitude', 'Longitude', 'Radius (meters)'],
  'government-id-number': ['ID number'],
  field: ['Field value'],
  'ip-address': ['IP address or CIDR range'],
  name: ['First name', 'Last name'],
  'phone-number': ['Phone number'],
  'selfie-background': ['Inquiry ID'],
  string: ['Value'],
};

describe('adding an item of each kind (C97.1)', () => {
  it.each(LIST_KINDS)('asks a %s item for its own required fields', (kind) => {
    render(
      <ToastProvider>
        <AddItemForm listId="lst_01JC0000000000000000000001" kind={kind} action={vi.fn()} />
      </ToastProvider>,
    );

    const form = screen.getByRole('form', { name: 'Add an item' });
    for (const label of FIELDS[kind]) {
      expect(
        within(form).getByLabelText(new RegExp(`^${label.replace(/[()]/gu, '\\$&')}`, 'u')),
      ).toBeRequired();
    }
    if (kind === 'government-id-number') {
      const idClass = within(form).getByRole<HTMLSelectElement>('combobox', { name: 'ID class' });
      expect(idClass).toHaveValue('');
      expect(idClass.options[1]?.textContent).toBe('Passport');
    }
  });
});
