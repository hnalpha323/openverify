import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CONNECTION_IDS, connection } from './connect-fixtures';
import { ConnectionsTable } from './connections-table';

const rows = () => within(screen.getByRole('table', { name: 'Connections' })).getAllByRole('row');

describe('ConnectionsTable (C242.1)', () => {
  it('names each connection by its counterparty, with direction, status, policy version and creation time', () => {
    render(
      <ConnectionsTable
        caption="Connections"
        emptyMessage="None yet."
        connections={[connection('inbound'), connection('outbound', { status: 'inactive' })]}
      />,
    );

    expect(rows()[0]).toHaveTextContent(
      ['Counterparty', 'Direction', 'Status', 'Policy', 'Created (UTC)'].join(''),
    );
    const [, inbound, outbound] = rows();
    expect(screen.getAllByRole('rowheader')[0]).toHaveTextContent('Example Source');
    expect(inbound).toHaveTextContent('Inbound');
    expect(inbound).toHaveTextContent('Oct 20, 2026');
    expect(screen.getByRole('link', { name: 'Example Partner' })).toHaveAttribute(
      'href',
      `/settings/connect/connections/${CONNECTION_IDS.outbound}`,
    );
    expect(outbound).toHaveTextContent('Inactive');
  });

  it('says a newer version the destination has not accepted', () => {
    render(
      <ConnectionsTable
        caption="Connections"
        emptyMessage="None yet."
        connections={[connection('inbound', { status: 'pending', version: 3, acceptedVersion: 2 })]}
      />,
    );

    expect(rows()[1]).toHaveTextContent('Version 3, version 2 accepted');
  });

  it('says its empty message', () => {
    render(<ConnectionsTable caption="Connections" emptyMessage="None yet." connections={[]} />);

    expect(rows()[1]).toHaveTextContent('None yet.');
  });
});
