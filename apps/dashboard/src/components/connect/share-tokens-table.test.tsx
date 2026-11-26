import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SHARE_TOKEN_ID, shareToken } from './connect-fixtures';
import { ShareTokensTable } from './share-tokens-table';

describe('ShareTokensTable (C242.2)', () => {
  it('lists each token with its direction, source type, status, categories, expiry and creation', () => {
    render(
      <ShareTokensTable
        caption="Share tokens"
        emptyMessage="None yet."
        tokens={[
          shareToken('outbound'),
          shareToken('redeemed', {}, 'cnst_01M5CN0000000000000011A201'),
        ]}
      />,
    );

    const [header, outbound, redeemed] = within(
      screen.getByRole('table', { name: 'Share tokens' }),
    ).getAllByRole('row');
    expect(header).toHaveTextContent(
      [
        'Share token',
        'Direction',
        'Source',
        'Status',
        'Carries',
        'Expires (UTC)',
        'Created (UTC)',
      ].join(''),
    );
    expect(screen.getByRole('link', { name: SHARE_TOKEN_ID })).toHaveAttribute(
      'href',
      `/settings/connect/share-tokens/${SHARE_TOKEN_ID}`,
    );
    expect(outbound).toHaveTextContent('Outbound');
    expect(outbound).toHaveTextContent('Inquiry');
    expect(outbound).toHaveTextContent('Created');
    expect(outbound).toHaveTextContent('Biometric data');
    expect(redeemed).toHaveTextContent('Inbound');
    expect(redeemed).toHaveTextContent('Redeemed');
  });

  it('says its empty message', () => {
    render(<ShareTokensTable caption="Share tokens" emptyMessage="None yet." tokens={[]} />);

    expect(screen.getByText('None yet.')).toBeInTheDocument();
  });
});
