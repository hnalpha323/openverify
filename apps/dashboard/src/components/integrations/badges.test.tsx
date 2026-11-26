import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiKeyStateBadge,
  DeliveryStatusBadge,
  HttpStatusBadge,
  WebhookStatusBadge,
} from './badges';

describe('integration badges', () => {
  it.each([
    ['enabled', 'Enabled'],
    ['disabled', 'Disabled'],
    ['archived', 'Archived'],
  ] as const)('names the webhook status %s', (status, label) => {
    render(<WebhookStatusBadge status={status} />);

    expect(screen.getByText(label)).toHaveAttribute('data-status', status);
  });

  it.each([
    ['pending', 'Pending'],
    ['succeeded', 'Succeeded'],
    ['failed', 'Failed'],
  ] as const)('names the delivery status %s', (status, label) => {
    render(<DeliveryStatusBadge status={status} />);

    expect(screen.getByText(label)).toHaveAttribute('data-status', status);
  });

  it.each([
    ['active', 'Active'],
    ['expiring', 'Expires'],
    ['expired', 'Expired'],
  ] as const)('names the API key state %s', (state, label) => {
    render(<ApiKeyStateBadge state={state} />);

    expect(screen.getByText(label)).toHaveAttribute('data-status', state);
  });

  it.each([
    [201, 'success'],
    [304, 'neutral'],
    [404, 'attention'],
    [503, 'danger'],
  ] as const)('shows the HTTP status %i with the %s tone', (status, tone) => {
    render(<HttpStatusBadge status={status} />);

    expect(screen.getByText(String(status))).toHaveAttribute('data-tone', tone);
  });
});
