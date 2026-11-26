import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { connection } from './connect-fixtures';
import { isSamplePartner } from './connection-summary';
import { ConnectionsTable } from './connections-table';

describe('the seeded partner is labelled a sample (C244.4)', () => {
  it('recognises the name seed:dev --connect gives it, and its display name', () => {
    expect(isSamplePartner('Example Partner')).toBe(true);
    expect(isSamplePartner('Example Partner (sample)')).toBe(true);
    expect(isSamplePartner('Example Source')).toBe(false);
    expect(isSamplePartner(null)).toBe(false);
  });

  it('labels it in the connections list', () => {
    render(
      <ConnectionsTable
        caption="Connections"
        emptyMessage="None"
        connections={[connection('outbound'), connection('inbound')]}
      />,
    );

    expect(screen.getAllByText('Sample organization')).toHaveLength(1);
  });
});
