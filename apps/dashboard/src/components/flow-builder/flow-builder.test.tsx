import type { VerificationConfig } from '@openverify/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VERSION_CONTENT } from '../../testing/lifecycle-fixtures';
import { FlowBuilder, type FlowBuilderActions, type FlowBuilderProps } from './flow-builder';
import { builderFlow } from './test-flows';

const ETAG = `"${'a'.repeat(64)}"`;
const NEXT = `"${'b'.repeat(64)}"`;
const config: VerificationConfig = VERSION_CONTENT['verification-config'];

function actions(overrides: Partial<FlowBuilderActions> = {}): FlowBuilderActions {
  return {
    save: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { kind: 'saved' as const, etag: NEXT, problems: [] },
      }),
    ),
    check: vi.fn(() =>
      Promise.resolve({ ok: true as const, data: { problems: [], acknowledgements: [] } }),
    ),
    publish: vi.fn(() => Promise.resolve({ ok: true as const, data: { etag: NEXT } })),
    ...overrides,
  };
}

function show(
  props: Partial<Omit<FlowBuilderProps, 'actions'>> & {
    actions?: Partial<FlowBuilderActions>;
  } = {},
) {
  const user = userEvent.setup();
  const { actions: overrides, ...rest } = props;
  const given = actions(overrides);
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
      {...rest}
      actions={given}
    />,
  );
  return { user, actions: given };
}

const outline = () => screen.getByRole('tree', { name: 'Outline of the flow' });
const item = (name: string | RegExp) => within(outline()).getByRole('treeitem', { name });

describe('the flow builder (C155): outline first, by keyboard', () => {
  it('shows the flow as a tree from the entry, the first step the tree’s one tab stop', async () => {
    const { user } = show();

    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();

    expect(item('Consent')).toBeVisible();
    expect(item('Screen: Your details')).toHaveAttribute('aria-level', '1');
    expect(item('When attempts run out')).toHaveAttribute('aria-level', '2');
    expect(item('Go to Completion')).toBeVisible();
  });

  it('adds a step after another from its menu, saves it with If-Match, and announces it', async () => {
    const { user, actions: given } = show();

    item('Consent').focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('menuitem', { name: 'Add a step after' }));
    const palette = screen.getByRole('dialog', { name: 'Add a step after Consent' });
    await user.click(within(palette).getByRole('button', { name: /^Screen/ }));

    expect(item(/^Screen s_[a-z2-7]{8}$/)).toBeVisible();
    await waitFor(() => {
      expect(given.save).toHaveBeenCalledTimes(1);
    });
    const [saved] = vi.mocked(given.save).mock.calls[0] ?? [];
    expect(saved?.etag).toBe(ETAG);
    expect(saved?.flow.steps).toHaveLength(8);
    expect(screen.getByRole('status', { name: 'Draft status' })).toHaveTextContent(/Saved/);
  });

  it('offers a second verification of a type with its reason, never silently', async () => {
    const { user } = show();

    item('Consent').focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('menuitem', { name: 'Add a step after' }));

    const option = within(screen.getByRole('dialog')).getByRole('button', {
      name: /^Government ID/,
    });
    expect(option).toHaveAttribute('aria-disabled', 'true');
    expect(option).toHaveAccessibleDescription(/at most one step of each verification type/);
  });

  it('connects a port only to the targets the format allows', async () => {
    const { user } = show();

    item('Screen: Your details').focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('menuitem', { name: 'Connect Next to' }));
    const dialog = screen.getByRole('dialog', { name: 'Connect Next of Screen: Your details' });

    const choices = within(dialog)
      .getAllByRole('radio')
      .map((radio) => radio.getAttribute('value'));
    expect(choices).toContain('s_branch00');
    expect(choices).not.toContain('s_consent0');
  });

  it('undoes and redoes an edit', async () => {
    const { user } = show();

    item('Screen: Your details').focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete Screen: Your details?' })).getByRole(
        'button',
        {
          name: 'Delete step',
        },
      ),
    );
    expect(within(outline()).queryByRole('treeitem', { name: 'Screen: Your details' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(item('Screen: Your details')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(within(outline()).queryByRole('treeitem', { name: 'Screen: Your details' })).toBeNull();
  });

  it('lists the format’s problems in place, by step, as they change', () => {
    const flow = builderFlow();
    show({ flow: { ...flow, edges: flow.edges.filter((edge) => edge.id !== 'e_7') } });

    const problems = screen.getByRole('region', { name: 'Problems' });
    expect(problems).toHaveTextContent(/Branch: Age/);
    expect(item(/^Branch: Age, \d+ errors?$/)).toBeVisible();
  });

  it('opens “reload the latest draft” on a 412, with what changed on the server', async () => {
    const latest = builderFlow();
    const changed = { ...latest, steps: latest.steps.filter((step) => step.id !== 's_doc00000') };
    const { user, actions: given } = show({
      actions: {
        save: vi.fn(() =>
          Promise.resolve({
            ok: true as const,
            data: { kind: 'conflict' as const, latest: { flow: changed, etag: NEXT } },
          }),
        ),
      },
    });

    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'The draft changed since you opened it',
    });
    expect(dialog).toHaveTextContent('Removed: Document');
    await user.click(within(dialog).getByRole('button', { name: 'Reload the latest draft' }));
    expect(within(outline()).queryByRole('treeitem', { name: 'Document' })).toBeNull();
    expect(given.save).toHaveBeenCalledTimes(1);
  });

  it('publishes only once every acknowledgement is given, each with its reason', async () => {
    const { user, actions: given } = show({
      actions: {
        check: vi.fn(() =>
          Promise.resolve({
            ok: true as const,
            data: {
              problems: [],
              acknowledgements: ['fallback:s_govid000', 'adverse-path:s_fail0000'],
            },
          }),
        ),
      },
    });

    await user.click(screen.getByRole('button', { name: 'Publish…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Publish this draft' });
    const publish = within(dialog).getByRole('button', { name: 'Publish version' });
    expect(publish).toBeDisabled();
    const fallback = within(dialog).getByRole('checkbox', { name: /fallback:s_govid000/ });
    expect(fallback).toHaveAccessibleDescription(/exhausted/i);
    await user.click(fallback);
    await user.click(within(dialog).getByRole('checkbox', { name: /adverse-path:s_fail0000/ }));
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Publish note' }),
      'Synthetic note',
    );
    await user.click(publish);

    expect(given.publish).toHaveBeenCalledWith({
      versionId: 'itmplv_01JB0000000000000000000002',
      etag: ETAG,
      acknowledgements: ['fallback:s_govid000', 'adverse-path:s_fail0000'],
      note: 'Synthetic note',
    });
  });

  it('says a version 1 draft was migrated and will be saved as version 2', () => {
    show({ migrated: true });

    expect(screen.getByText(/migrated to flow-spec 2/)).toBeVisible();
  });

  it('is read-only without the right to edit: no menu edits, no save', async () => {
    const { user, actions: given } = show({ canEdit: false, canPublish: false });

    item('Consent').focus();
    await user.keyboard('{Enter}');

    expect(screen.queryByRole('menuitem', { name: 'Add a step after' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
    expect(given.save).not.toHaveBeenCalled();
  });

  it('mounts the theme picker, and saves a chosen theme set with the draft (C155.8)', async () => {
    const { user, actions: given } = show({
      theme: {
        sets: [
          {
            id: 'theset_01JB0000000000000000000001',
            name: 'Synthetic brand',
            revision: 2,
            isDefault: false,
          },
        ],
        value: null,
      },
    });

    const panel = screen.getByRole('region', { name: /theme/i });
    await user.selectOptions(
      within(panel).getByRole('combobox'),
      'theset_01JB0000000000000000000001',
    );

    await waitFor(() => {
      expect(given.save).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(given.save).mock.calls[0]?.[0]).toMatchObject({
      themeSetId: 'theset_01JB0000000000000000000001',
      etag: ETAG,
    });
  });

  it('mounts the languages and copy panel it is given (C155.8)', () => {
    show({ copyPanel: <p>Synthetic copy panel</p> });

    expect(screen.getByText('Synthetic copy panel')).toBeVisible();
  });

  it('edits a branch route’s condition with the flow’s on-null choices and each fact’s source (C150)', async () => {
    const { user, actions: given } = show();

    item('Branch: Age').focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('menuitem', { name: 'Open settings' }));

    const route = screen.getByRole('region', { name: 'Condition of the route Under 18' });
    const onNull = within(route).getByRole('combobox', {
      name: 'When a value it reads is unknown (null)',
    });
    expect(onNull).toHaveValue('review');
    expect(within(onNull).queryByRole('option', { name: /error/i })).toBeNull();
    expect(screen.getByRole('list', { name: 'Facts the branch reads' })).toHaveTextContent(
      'verifications.s_govid000.age-years',
    );
    expect(screen.getByText(/no lists\. path/i)).toBeVisible();

    await user.selectOptions(onNull, 'else');
    await waitFor(() => {
      expect(given.save).toHaveBeenCalled();
    });
    const saved = vi.mocked(given.save).mock.calls.at(-1)?.[0].flow;
    const branch = saved?.steps.find((step) => step.id === 's_branch00');
    expect(branch?.type === 'branch' ? branch.routes[0]?.onNull : null).toBe('else');
  });
});

// WCAG 2.5.7 (C171.3; Workflow 9D, a11y-audit): what the canvas does by dragging (drawing a
// connection, placing a step) a single pointer does without one, as the workflow editor offers
// (C141.3): the selected step's actions from a button, and "Tidy up" for the layout.
describe('the flow builder with a single pointer, no drag (2.5.7)', () => {
  it('opens the selected step’s actions from a button and connects a port by clicks only', async () => {
    const { user, actions: given } = show();
    const actionsButton = () =>
      screen.getByRole('button', { name: 'Actions for the selected step' });

    expect(actionsButton()).toBeDisabled();
    await user.click(item('Screen: Your details'));
    expect(actionsButton()).toBeEnabled();
    await user.click(actionsButton());
    await user.click(screen.getByRole('menuitem', { name: 'Connect Next to' }));
    const dialog = screen.getByRole('dialog', { name: 'Connect Next of Screen: Your details' });
    await user.click(within(dialog).getByRole('radio', { name: /^Branch: Age/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(given.save).toHaveBeenCalledTimes(1);
    });
    const [saved] = vi.mocked(given.save).mock.calls[0] ?? [];
    expect(saved?.flow.edges).toContainEqual(
      expect.objectContaining({ from: 's_screen00', port: 'next', to: 's_branch00' }),
    );
  });

  it('tidies the layout with one click, placing every step', async () => {
    const { user, actions: given } = show();

    await user.click(screen.getByRole('button', { name: 'Tidy up' }));

    await waitFor(() => {
      expect(given.save).toHaveBeenCalledTimes(1);
    });
    const [saved] = vi.mocked(given.save).mock.calls[0] ?? [];
    const layout = saved?.flow.layout ?? {};
    expect(Object.keys(layout).sort()).toEqual(
      builderFlow()
        .steps.map((step) => step.id)
        .sort(),
    );
    expect(screen.getByRole('status', { name: 'Draft status' })).toHaveTextContent(/Saved/);
  });
});
