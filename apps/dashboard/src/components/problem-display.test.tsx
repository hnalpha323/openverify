import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProblemDisplay } from './problem-display';

describe('ProblemDisplay', () => {
  it("announces the problem's title and detail as an alert", () => {
    render(
      <ProblemDisplay
        problem={{ title: 'Invalid Transition', detail: 'The inquiry is already approved.' }}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Invalid Transition');
    expect(alert).toHaveTextContent('The inquiry is already approved.');
  });

  it('lists field errors and the request id to quote', () => {
    render(
      <ProblemDisplay
        problem={{
          title: 'Check the values you entered',
          errors: [{ pointer: '/email', detail: 'Invalid email address' }],
          requestId: 'req-synthetic-0001',
        }}
      />,
    );

    expect(screen.getByRole('list', { name: 'Problems' })).toHaveTextContent(
      '/email: Invalid email address',
    );
    expect(screen.getByText('req-synthetic-0001')).toBeVisible();
  });

  it('renders nothing without a problem', () => {
    const { container } = render(<ProblemDisplay problem={undefined} />);

    expect(container).toBeEmptyDOMElement();
  });
});
