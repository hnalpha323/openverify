import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { diffAttributes } from '../../testing/routes/flow-builder';
import { VersionDiffList } from './version-diff-list';

const FROM = 'itmplv_01JB0000000000000000000002';
const TO = 'itmplv_01JB0000000000000000000001';

describe('the diff of two versions as a list (C154.6, C155.7)', () => {
  it('lists steps, edges, members and every consequence in words, never as layout only', () => {
    render(
      <VersionDiffList
        diff={diffAttributes(FROM, TO, {
          steps: {
            added: ['s_doc00000'],
            removed: ['s_old00000'],
            changed: [
              {
                'step-id': 's_screen00',
                changes: [{ pointer: '/steps/1/name', before: 'A', after: 'B' }],
              },
            ],
          },
          edges: { added: ['e_9'], removed: [], retargeted: ['e_2'] },
          'verification-config': [
            { pointer: '/selfie/checks/liveness/required', before: true, after: false },
          ],
          consequences: [
            { code: 'required_check_relaxed', pointer: '/verification-config/selfie' },
            { code: 'consent_text_changed', pointer: '/flow/steps/0' },
          ],
        })}
      />,
    );

    const consequences = screen.getByRole('list', { name: 'Consequences' });
    expect(
      within(consequences)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining('A required check was turned off or made optional'),
      expect.stringContaining('A consent text changed: new sessions need fresh consent'),
    ]);
    const changes = screen.getByRole('list', { name: 'Changes' });
    expect(changes).toHaveTextContent('Step added: s_doc00000');
    expect(changes).toHaveTextContent('Step removed: s_old00000');
    expect(changes).toHaveTextContent('Step changed: s_screen00 (/steps/1/name)');
    expect(changes).toHaveTextContent('Connection added: e_9');
    expect(changes).toHaveTextContent('Connection re-targeted: e_2');
    expect(changes).toHaveTextContent(
      'Verification config changed at /selfie/checks/liveness/required',
    );
    expect(screen.queryByText(/layout only/i)).toBeNull();
  });

  it('says when only the layout changed, and when nothing did', () => {
    const { rerender } = render(
      <VersionDiffList diff={diffAttributes(FROM, TO, { 'layout-only': true })} />,
    );
    expect(
      screen.getByText('Only the layout changed: nothing a person sees or the server decides.'),
    ).toBeVisible();

    rerender(<VersionDiffList diff={diffAttributes(FROM, TO)} />);
    expect(screen.getByText('The two versions hold the same content.')).toBeVisible();
  });
});
