import type { VerificationConfig } from '@openverify/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VERSION_CONTENT } from '../../testing/lifecycle-fixtures';
import { FlowBuilder } from './flow-builder';
import { builderFlow } from './test-flows';

const config: VerificationConfig = VERSION_CONTENT['verification-config'];

// K9-6 (C150.11): the builder hands the format's own problems to the branch it shows, so a
// tipping-off route's warning is read where the route is edited.
describe('the flow builder shows a branch’s warnings in its settings (C150.11)', () => {
  it('names a tipping-off route at the branch, recommending flag_for_review', async () => {
    const user = userEvent.setup();
    const flow = builderFlow();
    const listed = {
      ...flow,
      steps: flow.steps.map((step) =>
        step.type === 'branch'
          ? {
              ...step,
              routes: [
                {
                  key: 'minor',
                  label: 'Under 18',
                  condition: {
                    '===': [{ var: 'lists.lst_01JB0000000000000000000001.matched' }, true],
                  },
                  onNull: 'review',
                },
              ],
            }
          : step,
      ),
    };
    render(
      <FlowBuilder
        versionId="itmplv_01JB0000000000000000000002"
        flow={listed}
        etag={`"${'a'.repeat(64)}"`}
        migrated={false}
        verificationConfig={config}
        canEdit
        canPublish
        autosaveMs={0}
        actions={{ save: vi.fn(), check: vi.fn(), publish: vi.fn() }}
      />,
    );

    const outline = screen.getByRole('tree', { name: 'Outline of the flow' });
    await user.click(within(outline).getByRole('treeitem', { name: 'Branch: Age' }));

    expect(screen.getByRole('list', { name: 'Warnings at this branch' })).toHaveTextContent(
      /Route Under 18 .*flag_for_review/,
    );
  });
});
