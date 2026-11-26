import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PEEKED_NAME, shareToken } from './connect-fixtures';
import { PeekView } from './peek-view';

const SOURCE_DATA = shareToken('peek').attributes['source-data'];

describe('PeekView (C242.2, C233.2, C233.3)', () => {
  it('shows a full attribute as its value and a presence as present or not present', () => {
    if (SOURCE_DATA === undefined) {
      throw new Error('the golden peek holds source data');
    }
    render(<PeekView sourceData={SOURCE_DATA} />);

    const fields = screen.getByRole('table', { name: 'Inquiry fields' });
    const row = (name: string) => within(fields).getByRole('row', { name: new RegExp(`^${name}`) });
    expect(row('name_first')).toHaveTextContent(PEEKED_NAME);
    expect(row('name_last')).toHaveTextContent('Present');
    const attributes = screen.getByRole('table', { name: 'Inquiry' });
    expect(within(attributes).getByRole('row', { name: /^status/ })).toHaveTextContent('approved');
  });

  it('shows each related verification as its own snapshot, its files only as present', () => {
    if (SOURCE_DATA === undefined) {
      throw new Error('the golden peek holds source data');
    }
    render(<PeekView sourceData={SOURCE_DATA} />);

    const id = screen.getByRole('table', { name: 'Government ID verification' });
    expect(within(id).getByRole('row', { name: /^Files/ })).toHaveTextContent('Present');
    expect(screen.getByRole('table', { name: 'Selfie verification' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Database verification' })).toBeInTheDocument();
  });

  it('says not present for a presence whose source holds nothing, and shows nothing the policy does not share', () => {
    render(
      <PeekView
        sourceData={{
          type: 'connect/source-data/account',
          attributes: {},
          fields: { name_last: { visibility: 'presence', value: false } },
        }}
      />,
    );

    expect(screen.getByRole('row', { name: /^name_last/ })).toHaveTextContent('Not present');
    expect(screen.getByRole('table', { name: 'Account' })).toHaveTextContent(
      'The policy shares no attribute here.',
    );
  });

  it('shows a structured value as JSON', () => {
    render(
      <PeekView
        sourceData={{
          type: 'connect/source-data/verification/document',
          attributes: {
            checks: { visibility: 'full', value: [{ name: 'id_expired', status: 'passed' }] },
          },
        }}
      />,
    );

    expect(screen.getByRole('row', { name: /^checks/ })).toHaveTextContent(
      '[{"name":"id_expired","status":"passed"}]',
    );
  });
});
