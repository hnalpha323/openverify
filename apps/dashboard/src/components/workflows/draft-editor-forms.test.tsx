import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { WORKFLOW_IDS as IDS } from '../../testing/workflow-fixtures';
import { DraftEditor, type DraftResult } from './draft-editor';
import type { CatalogueAction } from './editor/palette-model';

type Action = (
  state: ActionState<DraftResult>,
  formData: FormData,
) => Promise<ActionResult<DraftResult>>;

/** Catalogue rows (C122.4) with the schemas `z.toJSONSchema()` gives; every value synthetic. */
const row = (key: string, kind: string, configSchema: unknown, outputSchema: unknown) => ({
  key,
  version: 1,
  kind,
  stage: key === 'get_list_match' ? 'beta' : 'ga',
  delivery: 'pure',
  adverse: 'never',
  triggers: null,
  available: true,
  reason: null,
  configSchema,
  outputSchema,
});

const ACTIONS: CatalogueAction[] = [
  row(
    'send_email',
    'egress',
    {
      type: 'object',
      properties: {
        subject: { type: 'string', maxLength: 200 },
        'max-tries': { type: 'integer', minimum: 1, maximum: 5 },
      },
      required: ['subject'],
    },
    {
      type: 'object',
      properties: {
        delivery: { type: 'string', enum: ['recorded', 'accepted', 'unknown'], pii: false },
      },
    },
  ),
  row(
    'get_list_match',
    'internal',
    { type: 'object', properties: {} },
    { type: 'object', properties: { matched: { type: ['boolean', 'null'], pii: false } } },
  ),
  row(
    'evaluate_code',
    'compute',
    { type: 'object', properties: { source: { type: 'string' } }, required: ['source'] },
    { type: 'object', properties: { value: { pii: true } } },
  ),
];

const action = (id: string, key: string, config: Record<string, unknown> = {}) => ({
  id,
  name: id.replaceAll('_', ' '),
  type: 'action',
  'action-key': key,
  'action-version': 1,
  config,
});

const definition = () => ({
  'schema-version': 1,
  trigger: { type: 'trigger-api', config: {} },
  inputs: [
    { name: 'email', type: 'string pii', required: true },
    { name: 'note', type: 'string', required: false },
  ],
  variables: [],
  steps: [
    action('screen', 'get_list_match'),
    {
      id: 'decide',
      name: 'Decide',
      type: 'conditional',
      routes: [
        { key: 'hit', label: 'Hit' },
        { key: 'miss', label: 'Miss' },
      ],
    },
    action('tell', 'send_email', { subject: 'Hello' }),
    action('score', 'evaluate_code', { source: 'export default () => 1' }),
    { id: 'output', name: 'Output', type: 'output', mappings: {} },
  ],
  edges: [
    { id: 'e0', from: 'trigger', 'from-port': 'next', to: 'screen' },
    { id: 'e1', from: 'screen', 'from-port': 'next', to: 'decide' },
    { id: 'e2', from: 'decide', 'from-port': 'route:hit', to: 'tell' },
    { id: 'e3', from: 'decide', 'from-port': 'route:miss', to: 'score' },
    { id: 'e4', from: 'decide', 'from-port': 'else', to: 'output' },
    { id: 'e5', from: 'tell', 'from-port': 'next', to: 'output' },
    { id: 'e6', from: 'score', 'from-port': 'next', to: 'output' },
  ],
  outputs: [{ name: 'decision', pii: false }],
  layout: {},
});

const show = () => {
  render(
    <DraftEditor
      workflowId={IDS.workflow}
      lockVersion={1}
      definition={JSON.stringify(definition(), null, 2)}
      warnings={[]}
      actions={ACTIONS}
      action={vi.fn<Action>()}
    />,
  );
};

const stored = () =>
  JSON.parse(screen.getByRole<HTMLTextAreaElement>('textbox', { name: /^Definition/ }).value) as {
    steps: Record<string, unknown>[];
    inputs: Record<string, unknown>[];
  };
const storedStep = (id: string) => stored().steps.find((step) => step.id === id);
const select = async (name: string) => {
  await userEvent.click(
    within(screen.getByRole('tree', { name: 'Outline of the definition' })).getByRole('treeitem', {
      name,
    }),
  );
};

describe('step forms from the catalogue’s config schema (C141.4)', () => {
  it('offers a field per config member and applies a typed value as one undoable edit', async () => {
    show();
    await select('Action send_email: tell');

    const settings = screen.getByRole('region', { name: 'Step settings' });
    const subject = within(settings).getByRole('textbox', { name: 'subject (required)' });
    expect(subject).toHaveValue('Hello');
    fireEvent.change(subject, { target: { value: 'Case {{ trigger.id }}' } });

    expect(storedStep('tell')?.config).toEqual({ subject: 'Case {{ trigger.id }}' });
    expect(screen.getByRole('status', { name: 'Editor status' })).toHaveTextContent(
      'Changed subject of tell.',
    );
  });

  it('says a value that does not hold its type at its field, and does not apply it', async () => {
    show();
    await select('Action send_email: tell');

    const tries = screen.getByRole('textbox', { name: 'max-tries' });
    fireEvent.change(tries, { target: { value: '2.5' } });

    expect(tries).toHaveAttribute('aria-invalid', 'true');
    expect(tries).toHaveAccessibleDescription(/Enter a whole number, or one \{\{ path \}\}\./);
    expect(storedStep('tell')?.config).toEqual({ subject: 'Hello' });
  });

  it('inserts a variable from the picker, each path with its type and marks, and marks the egress', async () => {
    show();
    await select('Action send_email: tell');

    expect(screen.queryByText(/Egress: personal data leaves OpenVerify/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Insert a variable into subject' }));
    const picker = screen.getByRole('dialog', { name: 'Insert a variable' });
    const paths = within(picker).getByRole('list', { name: 'Paths in scope' });
    expect(paths).toHaveTextContent('Input: string · personal data');
    expect(paths).toHaveTextContent('Input: string · can be unknown (null)');
    expect(paths).toHaveTextContent('Step screen: boolean · can be unknown (null)');
    await userEvent.click(within(picker).getByRole('button', { name: 'Insert inputs.email' }));

    expect(screen.queryByRole('dialog', { name: 'Insert a variable' })).toBeNull();
    expect((storedStep('tell')?.config as { subject: string }).subject).toContain(
      '{{ inputs.email }}',
    );
    expect(
      screen.getByText(/Egress: personal data leaves OpenVerify in this step \(inputs\.email\)/),
    ).toBeVisible();
    expect(screen.getByText(/acknowledgement egress:tell/)).toBeVisible();
  });

  it('links an Evaluate Code step to its sandbox test from this step to this step (C120.7, C141.9)', async () => {
    show();
    await select('Action evaluate_code: score');

    expect(screen.getByRole('link', { name: 'Test this step' })).toHaveAttribute(
      'href',
      `/workflows/${IDS.workflow}/test-runs?start-step=score&end-step=score`,
    );
  });
});

describe('the condition builder (C114, C141.4)', () => {
  it('writes a route’s condition, and asks what happens on an unknown value, with no default (C114.6)', async () => {
    show();
    await select('Conditional: Decide');

    const builder = screen.getByRole('region', { name: 'Condition of the route Hit' });
    await userEvent.click(within(builder).getByRole('button', { name: 'Add a comparison' }));
    await userEvent.selectOptions(
      within(builder).getByRole('combobox', { name: 'Path of comparison 1 of group 1' }),
      'steps.screen.output.matched',
    );

    const comparison = within(builder).getByRole('combobox', {
      name: 'Comparison of comparison 1 of group 1',
    });
    expect(
      within(comparison)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['is', 'is unknown (null)']);
    const onNull = within(builder).getByRole('combobox', {
      name: 'When a value it reads is unknown (null)',
    });
    expect(onNull).toHaveValue('');
    expect(onNull).toHaveAccessibleDescription(/no default/);
    expect(
      within(onNull)
        .getAllByRole('option')
        .map((option) => option.getAttribute('value')),
    ).toEqual(['', 'error', 'skip-route', 'route:miss']);

    await userEvent.selectOptions(onNull, 'skip-route');

    expect((storedStep('decide')?.routes as unknown[])[0]).toEqual({
      key: 'hit',
      label: 'Hit',
      condition: { '===': [{ var: 'steps.screen.output.matched' }, true] },
      'on-null': 'skip-route',
    });
  });

  it('never offers personal data for a comparison with typed text', async () => {
    show();
    await select('Conditional: Decide');

    const builder = screen.getByRole('region', { name: 'Condition of the route Hit' });
    await userEvent.click(within(builder).getByRole('button', { name: 'Add a comparison' }));
    const paths = within(
      within(builder).getByRole('combobox', { name: 'Path of comparison 1 of group 1' }),
    )
      .getAllByRole('option')
      .map((option) => option.getAttribute('value'));

    expect(paths).not.toContain('inputs.email');
    expect(paths).toContain('inputs.note');
  });

  it('orders and removes routes, the order they are tried in', async () => {
    show();
    await select('Conditional: Decide');

    await userEvent.click(screen.getByRole('button', { name: 'Try Miss earlier' }));

    expect((storedStep('decide')?.routes as { key: string }[]).map(({ key }) => key)).toEqual([
      'miss',
      'hit',
    ]);
  });
});

describe('the trigger, inputs, variables and outputs panels (C141.9)', () => {
  it('lists each path with its nullable and PII marks, and adds an input', async () => {
    show();

    const inputs = screen.getByRole('region', { name: 'Inputs' });
    const paths = within(inputs).getByRole('list', { name: 'Paths of the inputs' });
    expect(paths).toHaveTextContent('inputs.email: string · personal data');
    expect(paths).toHaveTextContent('inputs.note: string · can be unknown (null)');

    await userEvent.type(
      within(inputs).getByRole('textbox', { name: 'New input name' }),
      'reference',
    );
    await userEvent.click(within(inputs).getByRole('button', { name: 'Add' }));

    expect(stored().inputs.map((input) => input.name)).toEqual(['email', 'note', 'reference']);
    expect(screen.getByRole('status', { name: 'Editor status' })).toHaveTextContent(
      'Added the input reference.',
    );
  });

  it('says an API trigger has no object view, and offers its options', () => {
    show();

    const trigger = screen.getByRole('region', { name: 'Trigger' });
    expect(trigger).toHaveTextContent(
      'This trigger has no view of an object: its runs read the inputs.',
    );
    expect(
      within(trigger).getByRole('checkbox', { name: /One run per subject at a time/ }),
    ).not.toBeChecked();
  });

  it('declares an output and maps its value on the output node', () => {
    show();

    const outputs = screen.getByRole('region', { name: 'Outputs' });
    fireEvent.change(within(outputs).getByRole('textbox', { name: 'Value of decision' }), {
      target: { value: '{{ steps.screen.output.matched }}' },
    });

    expect(storedStep('output')?.mappings).toEqual({
      decision: '{{ steps.screen.output.matched }}',
    });
  });
});

describe('decision templates in the palette (C128.5, decision 51)', () => {
  it('offers the review-first templates and adds one where the step goes', async () => {
    show();
    await select('Action evaluate_code: score');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for the selected item' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add a step after…' }));

    const palette = screen.getByRole('dialog', { name: 'Add a step' });
    const templates = within(palette).getByRole('group', { name: 'Decision templates' });
    await userEvent.click(
      within(templates).getByRole('radio', {
        name: /Review a completed inquiry, then decide from the case/,
      }),
    );
    await userEvent.click(within(palette).getByRole('button', { name: 'Add step' }));

    expect(stored().steps.map((step) => step.id)).toContain('mark_review');
    expect(storedStep('decline')).toMatchObject({ 'action-key': 'decline_inquiry' });
  });
});
