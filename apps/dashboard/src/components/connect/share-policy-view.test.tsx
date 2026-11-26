import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SharePolicyChanges, SharePolicyView } from './share-policy-view';

describe('SharePolicyView and SharePolicyChanges (C242.1)', () => {
  it('lists the policy as terms and values', () => {
    render(<SharePolicyView statements={[{ id: 'files', term: 'Files', value: 'Shared' }]} />);

    expect(screen.getByText('Files', { selector: 'dt' }).nextElementSibling).toHaveTextContent(
      'Shared',
    );
  });

  it('lists each changed member with both versions’ words, named by the versions', () => {
    render(
      <SharePolicyChanges
        beforeVersion={1}
        afterVersion={2}
        changes={[{ id: 'files', term: 'Files', before: 'Shared', after: 'Not shared' }]}
      />,
    );

    const table = screen.getByRole('table', { name: 'Changes from version 1 to version 2' });
    const [header, row] = within(table).getAllByRole('row');
    expect(header).toHaveTextContent('MemberVersion 1Version 2');
    expect(row).toHaveTextContent('FilesSharedNot shared');
  });

  it('says when two versions say the same', () => {
    render(<SharePolicyChanges beforeVersion={2} afterVersion={3} changes={[]} />);

    expect(screen.getByText('The two versions say the same.')).toBeInTheDocument();
  });
});
