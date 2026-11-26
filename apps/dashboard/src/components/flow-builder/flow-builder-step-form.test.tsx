import type { VerificationConfig } from '@openverify/contracts';
import type { FlowV2Step } from '@openverify/flow-spec';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VERSION_CONTENT } from '../../testing/lifecycle-fixtures';
import { FlowBuilder } from './flow-builder';
import { builderFlow } from './test-flows';

const form = vi.hoisted(() => ({
  props: [] as { step: FlowV2Step; editable: boolean }[],
}));

vi.mock('../schema-form/step-schema-form', () => ({
  StepSchemaForm: (props: {
    step: FlowV2Step;
    editable: boolean;
    onStepChange: (next: FlowV2Step, message: string) => void;
  }) => {
    form.props.push(props);
    return (
      <button
        type="button"
        onClick={() => {
          props.onStepChange(
            { ...props.step, name: 'Renamed by the form' } as FlowV2Step,
            'Renamed.',
          );
        }}
      >
        Generated form of {props.step.id}
      </button>
    );
  },
}));

const config: VerificationConfig = VERSION_CONTENT['verification-config'];

describe('the generated step form in the builder’s step panel (C153.1, C155.3; requested by dashboard-template-forms R4)', () => {
  it('renders the step’s generated form above its JSON, and records its change as one edit', async () => {
    const user = userEvent.setup();
    const save = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { kind: 'saved' as const, etag: '"x"', problems: [] },
      }),
    );
    render(
      <FlowBuilder
        versionId="itmplv_01JB0000000000000000000002"
        flow={builderFlow()}
        etag={`"${'a'.repeat(64)}"`}
        migrated={false}
        verificationConfig={config}
        canEdit
        canPublish={false}
        autosaveMs={60_000}
        actions={{
          save,
          check: vi.fn(),
          publish: vi.fn(),
        }}
      />,
    );
    const outline = screen.getByRole('tree', { name: 'Outline of the flow' });
    await user.click(within(outline).getByRole('treeitem', { name: 'Screen: Your details' }));

    const generated = screen.getByRole('button', { name: 'Generated form of s_screen00' });
    expect(form.props.at(-1)).toMatchObject({ editable: true });
    await user.click(generated);

    expect(
      within(outline).getByRole('treeitem', { name: 'Screen: Renamed by the form' }),
    ).toBeVisible();
    expect(screen.getByRole('status', { name: 'Draft status' })).toHaveTextContent('Renamed.');
  });
});
