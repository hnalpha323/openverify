/**
 * C128.7: the person reaches the contest route of a declined inquiry, and the host shows before the
 * link. The flow says nothing else about the decision. Synthetic values only.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeFlowApi } from '../testing/fake-flow-api';
import { INQUIRY_ID, flowSession } from '../testing/flow-fixtures';
import { renderWithFlow } from '../test-utils';
import { FlowRenderer } from './flow-renderer';

describe('a declined inquiry (C128.7)', () => {
  it('shows the contest route it names', async () => {
    const api = new FakeFlowApi();
    api.client.getSession.mockResolvedValue({
      ...flowSession({ status: 'declined' }),
      'decision-contest-route': {
        url: 'https://help.example.com/review',
        host: 'help.example.com',
        contact: null,
      },
    });

    renderWithFlow(<FlowRenderer client={api.client} inquiryId={INQUIRY_ID} />);

    const link = await screen.findByRole('link');
    expect(link).toHaveAttribute('href', 'https://help.example.com/review');
    expect(document.body).toHaveTextContent('help.example.com');
  });
});
