import type { VerificationConfig } from '@openverify/contracts';
import { defaultTemplateConfig, listChecks } from '@openverify/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';
import { CHECK_READING_FLOW } from '../../testing/routes/template-forms';
import { StepPanel } from './step-panel';
import { VerificationTypePanel } from './verification-type-panel';

const COPY = TEMPLATE_FORMS_COPY.checkPanels;
const GOVERNMENT_ID = defaultTemplateConfig('government_id');
const BETA = listChecks('government_id').find((check) => check.stage === 'beta');
const GA = listChecks('government_id').find((check) => check.stage === 'ga');

type TypeConfig = NonNullable<VerificationConfig['government-id']>;

function Holder({
  initial = GOVERNMENT_ID,
  seen,
  editable = true,
}: {
  initial?: TypeConfig;
  seen?: (config: TypeConfig, message: string) => void;
  editable?: boolean;
}) {
  const [config, setConfig] = useState<TypeConfig>(initial);
  return (
    <VerificationTypePanel
      apiType="government-id"
      config={config}
      flow={CHECK_READING_FLOW}
      editable={editable}
      onChange={(next, message) => {
        setConfig(next);
        seen?.(next, message);
      }}
    />
  );
}

const panel = (check: string) => screen.getByRole('region', { name: check });

describe('the check panels (C153.1, ADR 0002)', () => {
  it('shows every check of the type with its tier, type, stage and default requirement', () => {
    render(<Holder />);

    for (const check of listChecks('government_id')) {
      const region = panel(check.id);
      expect(within(region).getByText(new RegExp(`^Tier ${check.tier}`))).toBeVisible();
      expect(within(region).getByText(COPY.type[check.checkType])).toBeVisible();
      expect(within(region).getByText(COPY.stage[check.stage])).toBeVisible();
      const requirement = !check.defaultEnabled
        ? 'disabled'
        : check.defaultRequired
          ? 'required'
          : 'advisory';
      expect(within(region).getByText(COPY.defaultRequirement[requirement])).toBeVisible();
    }
  });

  it('marks a beta check with its badge in words, and a GA check without it', () => {
    render(<Holder />);

    expect(BETA).toBeDefined();
    expect(within(panel(BETA?.id ?? '')).getByText(COPY.betaBadge)).toBeVisible();
    expect(within(panel(BETA?.id ?? '')).getByText(COPY.betaNote)).toBeVisible();
    expect(within(panel(GA?.id ?? '')).queryByText(COPY.betaBadge)).toBeNull();
  });

  it('says an enabled check that is not required runs but does not decide, unless a branch reads it', () => {
    render(
      <Holder
        initial={{
          checks: {
            id_expired_detection: { enabled: true, required: false },
            id_glare_detection: { enabled: true, required: false },
            id_blur_detection: { enabled: true, required: true },
          },
        }}
      />,
    );

    expect(
      within(panel('id_glare_detection')).getByText(COPY.decision['runs-not-deciding']),
    ).toBeVisible();
    expect(within(panel('id_blur_detection')).getByText(COPY.decision.decides)).toBeVisible();
    const expired = panel('id_expired_detection');
    expect(within(expired).getByText(COPY.decision['read-by-branch'])).toBeVisible();
    const branches = within(expired).getByRole('list', {
      name: COPY.branchesHeading('id_expired_detection'),
    });
    expect(
      within(branches).getByText(COPY.branchLine('Expired ID route', 'Expired ID')),
    ).toBeVisible();
    expect(within(panel('id_glare_detection')).getByText(COPY.noBranches)).toBeVisible();
  });

  it('runs, requires and configures a check, each change announced', async () => {
    const seen = vi.fn<(config: TypeConfig, message: string) => void>();
    render(
      <Holder
        initial={{ checks: { id_blur_detection: { enabled: true, required: true } } }}
        seen={seen}
      />,
    );

    const glare = panel('id_glare_detection');
    const require = within(glare).getByRole('checkbox', {
      name: COPY.required('id_glare_detection'),
    });
    expect(require).toBeDisabled();
    await userEvent.click(
      within(glare).getByRole('checkbox', { name: COPY.enabled('id_glare_detection') }),
    );
    expect(seen.mock.lastCall?.[0].checks.id_glare_detection).toEqual({
      enabled: true,
      required: false,
    });
    expect(seen.mock.lastCall?.[1]).toMatch(/id_glare_detection/);
    await userEvent.click(
      within(glare).getByRole('checkbox', { name: COPY.required('id_glare_detection') }),
    );
    expect(seen.mock.lastCall?.[0].checks.id_glare_detection).toEqual({
      enabled: true,
      required: true,
    });

    const settings = within(panel('id_blur_detection')).getByRole('group', {
      name: COPY.config('id_blur_detection'),
    });
    fireEvent.change(within(settings).getByRole('textbox', { name: 'min-document-width-px' }), {
      target: { value: '800' },
    });
    expect(seen.mock.lastCall?.[0].checks.id_blur_detection).toEqual({
      enabled: true,
      required: true,
      config: { 'min-document-width-px': 800 },
    });
  });

  it('offers only the options the contract lets the type set', () => {
    render(<Holder />);

    const options = screen.getByRole('group', { name: COPY.typeOptions('government-id') });
    expect(within(options).getByLabelText('allowed-countries')).toBeInTheDocument();
    expect(within(options).getByLabelText('allowed-id-classes')).toBeInTheDocument();
    expect(within(options).queryByLabelText('allowed-chains')).toBeNull();
    expect(within(options).queryByLabelText('accept-review-without-provider')).toBeNull();
  });

  it('says when the contract refuses the type’s configuration: no check left required', async () => {
    render(
      <Holder initial={{ checks: { id_blur_detection: { enabled: true, required: true } } }} />,
    );

    await userEvent.click(
      within(panel('id_blur_detection')).getByRole('checkbox', {
        name: COPY.required('id_blur_detection'),
      }),
    );

    expect(screen.getByText(COPY.typeProblems)).toBeVisible();
    expect(screen.getByText(/needs at least one enabled, required check/)).toBeVisible();
  });

  it('shows everything read-only, with no control to change', () => {
    render(<Holder editable={false} />);

    expect(
      screen.queryAllByRole('checkbox').every((box) => (box as HTMLInputElement).disabled),
    ).toBe(true);
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('StepPanel (the builder’s slot, C155.3, V07)', () => {
  const verificationConfig: VerificationConfig = { 'government-id': GOVERNMENT_ID };
  const step = (id: string) => {
    const found = CHECK_READING_FLOW.steps.find((each) => each.id === id);
    if (found === undefined) throw new Error(id);
    return found;
  };

  it('shows the selected verification step’s checks, and hands the builder the whole config', async () => {
    const change = vi.fn<(next: VerificationConfig, message: string) => void>();
    render(
      <StepPanel
        flow={CHECK_READING_FLOW}
        step={step('id_card')}
        verificationConfig={verificationConfig}
        editable
        onVerificationConfigChange={change}
      />,
    );

    expect(screen.getByRole('heading', { name: COPY.typeHeading('government-id') })).toBeVisible();
    await userEvent.click(
      within(panel('id_glare_detection')).getByRole('checkbox', {
        name: COPY.enabled('id_glare_detection'),
      }),
    );
    // The click turns the check the other way from the default configuration.
    expect(change.mock.lastCall?.[0]['government-id']?.checks.id_glare_detection).toMatchObject({
      enabled: !(GOVERNMENT_ID.checks.id_glare_detection?.enabled ?? false),
    });
  });

  it('renders nothing for a step that creates no verification', () => {
    const { container } = render(
      <StepPanel
        flow={CHECK_READING_FLOW}
        step={step('expiry_route')}
        verificationConfig={verificationConfig}
        editable
        onVerificationConfigChange={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
