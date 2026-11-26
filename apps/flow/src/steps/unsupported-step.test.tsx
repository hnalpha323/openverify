import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FlowStep } from '@openverify/flow-spec';
import { en } from '../i18n/locales/en';
import { renderWithI18n } from '../test-utils';
import { UnsupportedStep } from './unsupported-step';

const FORM = { id: 'details', type: 'form', fields: [] } as unknown as FlowStep;

const STEPS = [
  FORM,
  { id: 'proof', type: 'document', documentTypes: ['utility_bill'], captureMethods: ['upload'] },
  { id: 'phone', type: 'phone_otp', allowedCountries: ['US'] },
  { id: 'email', type: 'email_otp' },
  {
    id: 'records',
    type: 'database',
    fields: ['name_first', 'name_last', 'birthdate', 'address_country_code'],
  },
  { id: 'chip', type: 'nfc', androidOnly: true },
  // C50.3: the Phase 5 steps, named on this screen until their own screens land.
  { id: 'licence', type: 'aamva', source: 'form' },
  { id: 'wallet', type: 'crypto_wallet', chains: ['eip155:1'], signing: ['paste'] },
  { id: 'business', type: 'database_business' },
  { id: 'website', type: 'business_website' },
] as unknown as FlowStep[];

describe('UnsupportedStep', () => {
  it.each(STEPS)('says plainly that a $type step cannot be done here', (step) => {
    renderWithI18n(<UnsupportedStep step={step} reason="step" />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'This step is not available here' }),
    ).toBeVisible();
    const names: Readonly<Record<string, string | undefined>> = en.unsupported.steps;
    const name = names[step.type];
    expect(name, step.type).toBeDefined();
    expect(screen.getByRole('alert')).toHaveTextContent(
      en.unsupported.step.replace('{{step}}', name ?? ''),
    );
    expect(screen.getByText(en.unsupported.contact)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // Workflow 9A: the client walks no transitions, so a step is the only reason (C151.5); a step
  // with no name of its own (a projection's placeholder) explains that the flow cannot continue here.
  it('explains a step it cannot name', () => {
    renderWithI18n(
      <UnsupportedStep step={{ id: 'continue-1', type: 'server-continuation' }} reason="step" />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(en.unsupported.flow);
  });

  it('is translated', () => {
    renderWithI18n(<UnsupportedStep step={FORM} reason="step" />, 'es');

    expect(screen.getByRole('alert')).toHaveTextContent('un formulario');
  });
});
