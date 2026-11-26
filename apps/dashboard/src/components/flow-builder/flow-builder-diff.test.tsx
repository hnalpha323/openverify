import type { VerificationConfig } from '@openverify/contracts';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VERSION_CONTENT } from '../../testing/lifecycle-fixtures';
import { diffAttributes } from '../../testing/routes/flow-builder';
import { FlowBuilder } from './flow-builder';
import { builderFlow } from './test-flows';

const config: VerificationConfig = VERSION_CONTENT['verification-config'];
const DRAFT = 'itmplv_01JB0000000000000000000002';
const CURRENT = 'itmplv_01JB0000000000000000000001';

function show(withComparison: boolean) {
  return render(
    <FlowBuilder
      versionId={DRAFT}
      flow={builderFlow()}
      etag={`"${'a'.repeat(64)}"`}
      migrated={false}
      verificationConfig={config}
      canEdit
      canPublish
      autosaveMs={0}
      actions={{ save: vi.fn(), check: vi.fn(), publish: vi.fn() }}
      comparison={
        withComparison
          ? {
              versionNumber: 3,
              diff: diffAttributes(DRAFT, CURRENT, {
                steps: {
                  added: ['s_doc00000'],
                  removed: ['s_old00000'],
                  changed: [
                    {
                      'step-id': 's_branch00',
                      changes: [{ pointer: '/steps/4/routes/0', before: null, after: null }],
                    },
                  ],
                },
              }),
            }
          : null
      }
    />,
  );
}

// K9-5 (C155.7): the diff of the draft against the current version as canvas badges, an icon and
// a word each (1.4.1), the outline saying the same, beside the list the badges are read from.
describe('the flow builder draws the diff against the current version (C155.7)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('marks added and changed steps on the canvas and in the outline, from the same diff as its list', () => {
    const { container } = show(true);

    const node = (id: string) =>
      container.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
    expect(node('s_doc00000')).toHaveTextContent('Added');
    expect(node('s_branch00')).toHaveTextContent('Changed');
    expect(node('s_consent0')).not.toHaveTextContent(/Added|Changed/);
    const outline = screen.getByRole('tree', { name: 'Outline of the flow' });
    expect(within(outline).getByRole('treeitem', { name: 'Document, added' })).toBeVisible();
    expect(within(outline).getByRole('treeitem', { name: 'Branch: Age, changed' })).toBeVisible();
    const compared = screen.getByRole('region', { name: 'Compared with version 3' });
    expect(within(compared).getByRole('list', { name: 'Changes' })).toHaveTextContent(
      'Step removed: s_old00000',
    );
  });

  it('draws no badge and no comparison without one', () => {
    const { container } = show(false);

    expect(
      container.querySelector('.react-flow__node[data-id="s_doc00000"]'),
    ).not.toHaveTextContent('Added');
    expect(screen.queryByRole('region', { name: /^Compared with version/ })).toBeNull();
  });
});
