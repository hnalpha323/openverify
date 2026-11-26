import type { VerificationConfig } from '@openverify/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VERSION_CONTENT } from '../../testing/lifecycle-fixtures';
import { FlowBuilder, type FlowBuilderActions } from './flow-builder';
import { builderFlow } from './test-flows';

const ETAG = `"${'a'.repeat(64)}"`;
const NEXT = `"${'b'.repeat(64)}"`;
const config: VerificationConfig = VERSION_CONTENT['verification-config'];

function show() {
  const user = userEvent.setup();
  const actions: FlowBuilderActions = {
    save: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { kind: 'saved' as const, etag: NEXT, problems: [] },
      }),
    ),
    check: vi.fn(),
    publish: vi.fn(),
  };
  render(
    <FlowBuilder
      versionId="itmplv_01JB0000000000000000000002"
      flow={builderFlow()}
      etag={ETAG}
      migrated={false}
      verificationConfig={config}
      canEdit
      canPublish
      autosaveMs={0}
      actions={actions}
    />,
  );
  return { user, actions };
}

const outline = () => screen.getByRole('tree', { name: 'Outline of the flow' });
const item = (name: string | RegExp) => within(outline()).getByRole('treeitem', { name });

// K9-3 (C155.4, C155.11): modules are inserted from the outline by keyboard first, each saying
// what it inserts before it is inserted, a refused one offered with its reason.
describe('the flow builder’s modules, from the outline (C155.4)', () => {
  it('inserts a module from a step’s menu by keyboard, after reading what it inserts', async () => {
    const { user, actions } = show();

    item('Consent').focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('menuitem', { name: 'Add a module after' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a module after Consent' });
    const explanation = within(dialog).getByRole('checkbox', {
      name: 'With an explanation screen before the verification',
    });
    expect(explanation).not.toBeChecked();
    await user.click(explanation);
    const selfie = within(dialog).getByRole('button', { name: /^Selfie/ });
    expect(selfie).toHaveAccessibleDescription(
      /Inserts an explanation screen, a Selfie step and, when its attempts run out, a fallback screen/,
    );
    const governmentId = within(dialog).getByRole('button', { name: /^Government ID/ });
    expect(governmentId).toHaveAttribute('aria-disabled', 'true');
    expect(governmentId).toHaveAccessibleDescription(/at most one step of each verification type/);

    selfie.focus();
    await user.keyboard('{Enter}');

    expect(screen.queryByRole('dialog', { name: 'Add a module after Consent' })).toBeNull();
    expect(item('Selfie')).toBeVisible();
    expect(screen.getByRole('status', { name: 'Draft status' })).toHaveTextContent(
      /Inserted the Selfie module after Consent|Saved/,
    );
    await waitFor(() => {
      expect(actions.save).toHaveBeenCalledTimes(1);
    });
    const saved = vi.mocked(actions.save).mock.calls[0]?.[0].flow;
    expect(saved?.steps.map((step) => step.type).filter((type) => type === 'selfie')).toEqual([
      'selfie',
    ]);
    expect(saved?.steps).toHaveLength(builderFlow().steps.length + 3);
  });

  it('refuses nothing silently: a module clicked while refused inserts nothing', async () => {
    const { user, actions } = show();

    item('Consent').focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('menuitem', { name: 'Add a module after' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a module after Consent' });
    await user.click(within(dialog).getByRole('button', { name: /^Government ID/ }));

    expect(screen.getByRole('dialog', { name: 'Add a module after Consent' })).toBeVisible();
    expect(actions.save).not.toHaveBeenCalled();
  });

  it('offers modules at a port too, such as a branch’s route', async () => {
    const { user } = show();

    item('Route Under 18').focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('menuitem', { name: 'Add a module here' }));

    expect(
      screen.getByRole('dialog', { name: 'Add a module after Route Under 18 of Branch: Age' }),
    ).toBeVisible();
  });
});
