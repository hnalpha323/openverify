import type { VerificationConfig } from '@openverify/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VERSION_CONTENT } from '../../testing/lifecycle-fixtures';
import { FlowBuilder, type FlowBuilderActions } from './flow-builder';
import { builderFlow } from './test-flows';

const config: VerificationConfig = VERSION_CONTENT['verification-config'];

// K9-4 (C155.5): a selected screen opens its screen editor in the builder, whose edits are the
// builder's own (history, autosave, the format's rules in place).
describe('the flow builder edits a screen in its screen editor (C155.5)', () => {
  it('adds a component to the selected screen and saves it with the draft', async () => {
    const user = userEvent.setup();
    const actions: FlowBuilderActions = {
      save: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          data: { kind: 'saved' as const, etag: `"${'b'.repeat(64)}"`, problems: [] },
        }),
      ),
      check: vi.fn(),
      publish: vi.fn(),
    };
    render(
      <FlowBuilder
        versionId="itmplv_01JB0000000000000000000002"
        flow={builderFlow()}
        etag={`"${'a'.repeat(64)}"`}
        migrated={false}
        verificationConfig={config}
        canEdit
        canPublish
        autosaveMs={0}
        actions={actions}
        fieldSchemas={[{ key: 'name_middle', type: 'string', pii: true }]}
      />,
    );

    const outline = screen.getByRole('tree', { name: 'Outline of the flow' });
    await user.click(within(outline).getByRole('treeitem', { name: 'Screen: Your details' }));
    const editor = screen.getByRole('region', { name: 'Components of the screen' });
    await user.selectOptions(within(editor).getByRole('combobox', { name: 'Kind' }), 'text_input');
    await user.click(within(editor).getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(actions.save).toHaveBeenCalledTimes(1);
    });
    const saved = vi.mocked(actions.save).mock.calls[0]?.[0].flow;
    const details = saved?.steps.find((step) => step.id === 's_screen00');
    expect(details?.type === 'screen' ? details.components.at(-1) : null).toMatchObject({
      kind: 'text_input',
      field: 'name_middle',
    });
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(
      within(screen.getByRole('list', { name: 'Components of the screen' })).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(1);
  });
});
