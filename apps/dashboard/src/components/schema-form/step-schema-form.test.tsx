import { stepV2Schema, type FlowV2Step } from '@openverify/flow-spec';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';
import { CHECK_READING_FLOW } from '../../testing/routes/template-forms';
import { jsonSchemaOf } from './model';
import { StepSchemaForm, stepMemberSchema } from './step-schema-form';

const COPY = TEMPLATE_FORMS_COPY.stepForm;

const found = CHECK_READING_FLOW.steps.find((step) => step.id === 'id_card');
if (found === undefined) {
  throw new Error('the fixture flow has no id_card step');
}
const ID_CARD: FlowV2Step = found;

function Holder({
  initial,
  seen,
  editable = true,
}: {
  initial: FlowV2Step;
  seen?: (step: FlowV2Step, message: string) => void;
  editable?: boolean;
}) {
  const [step, setStep] = useState<FlowV2Step>(initial);
  return (
    <StepSchemaForm
      step={step}
      editable={editable}
      onStepChange={(next, message) => {
        setStep(next);
        seen?.(next, message);
      }}
    />
  );
}

describe('StepSchemaForm (C153.1, C155.3): a flow step’s settings from its zod schema', () => {
  it('renders a control for every member of every step type but its id and type', () => {
    for (const option of stepV2Schema.options) {
      const type = option.shape.type.value;
      const members = Object.keys(jsonSchemaOf(stepMemberSchema(type)).properties ?? {});
      expect(members, type).not.toContain('id');
      expect(members, type).not.toContain('type');
    }
    render(<Holder initial={ID_CARD} />);

    const group = screen.getByRole('group', { name: COPY.legend('id_card') });
    for (const member of Object.keys(
      jsonSchemaOf(stepMemberSchema('government_id')).properties ?? {},
    )) {
      expect(
        // A required member is labelled "<name> (required)".
        within(group).getAllByLabelText(new RegExp(`^${member}( \\(required\\))?$`)).length,
        member,
      ).toBeGreaterThan(0);
    }
  });

  it('offers capture methods per device class, as client-reported guidance (C153.2)', async () => {
    const seen = vi.fn<(step: FlowV2Step, message: string) => void>();
    render(<Holder initial={ID_CARD} seen={seen} />);

    const byDevice = screen.getByRole('group', { name: 'captureMethodsByDevice' });
    expect(byDevice).toHaveAccessibleDescription(expect.stringContaining(COPY.captureByDevice));
    const mobile = within(byDevice).getByRole('group', { name: COPY.deviceGroup('mobile-web') });
    await userEvent.click(within(mobile).getByRole('checkbox', { name: 'upload' }));

    expect(seen.mock.lastCall?.[0]).toMatchObject({
      id: 'id_card',
      type: 'government_id',
      captureMethodsByDevice: { 'mobile-web': ['upload'] },
    });
    expect(seen.mock.lastCall?.[1]).toBe(COPY.announce('id_card', 'captureMethodsByDevice'));
    await userEvent.click(within(mobile).getByRole('checkbox', { name: 'upload' }));
    expect(seen.mock.lastCall?.[0]).not.toHaveProperty('captureMethodsByDevice');
  });

  it('ticks the capture methods the step offers', async () => {
    const seen = vi.fn<(step: FlowV2Step, message: string) => void>();
    render(<Holder initial={ID_CARD} seen={seen} />);

    const methods = screen.getByRole('group', { name: 'captureMethods (required)' });
    expect(within(methods).getByRole('checkbox', { name: 'camera' })).toBeChecked();
    await userEvent.click(within(methods).getByRole('checkbox', { name: 'upload' }));

    expect(seen.mock.lastCall?.[0]).toMatchObject({ captureMethods: ['camera', 'upload'] });
  });

  it('says at its field why the contract refuses a value', async () => {
    render(<Holder initial={ID_CARD} />);

    const attempts = screen.getByRole('textbox', { name: 'maxAttempts (required)' });
    await userEvent.clear(attempts);
    await userEvent.type(attempts, '0');

    expect(attempts).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the step read-only when the draft cannot be changed', () => {
    render(<Holder initial={ID_CARD} editable={false} />);

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(
      screen.queryAllByRole('checkbox').every((box) => (box as HTMLInputElement).disabled),
    ).toBe(true);
  });
});
