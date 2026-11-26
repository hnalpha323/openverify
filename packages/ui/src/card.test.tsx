import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card } from './card';

describe('Card', () => {
  it('is a region named by its title heading', () => {
    render(
      <Card title="Biometric consent">
        <p>Body</p>
      </Card>,
    );

    const region = screen.getByRole('region', { name: 'Biometric consent' });
    expect(region).toContainElement(screen.getByText('Body'));
    expect(screen.getByRole('heading', { level: 2, name: 'Biometric consent' })).toBeVisible();
  });

  it('lets screens choose the heading level', () => {
    render(<Card title="Sign in" headingLevel={1} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  });

  it('renders a plain container without a title', () => {
    const { container } = render(
      <Card className="mt-4">
        <p>Body</p>
      </Card>,
    );

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('mt-4');
  });
});
