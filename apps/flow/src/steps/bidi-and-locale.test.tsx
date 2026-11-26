import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentStep as DocumentFlowStep } from '../flow/flow-position';
import { FlowEnvironmentProvider } from '../flow/flow-environment';
import { createI18n } from '../i18n/create-i18n';
import { RequestedLanguagesContext } from '../session/requested-languages';
import { FakeFlowApi } from '../testing/fake-flow-api';
import { pdfFile } from '../testing/flow-fixtures';
import { FAST_POLLING, renderWithFlow } from '../test-utils';
import { DocumentStep } from './document/document-step';

// C161.2, C161.3 (Workflow 9A): `Intl` formats with the full tag the person asked for (`ar-EG` writes
// Arabic-Indic digits), and every interpolated value sits in its own `<bdi>`, so a number, an
// address or a Latin name inside Arabic text keeps its direction.

const PROOF: DocumentFlowStep = {
  id: 'proof',
  type: 'document',
  documentTypes: ['utility_bill'],
  captureMethods: ['upload'],
};

const capture = <Step,>(step: Step) =>
  ({ kind: 'capture', step, attempt: 1, maxAttempts: 3, verificationId: null, hints: [] }) as const;

describe('values in their own direction (C161.3)', () => {
  it('isolates a file name the person picked, a value written in any direction', async () => {
    const api = new FakeFlowApi();
    renderWithFlow(
      <DocumentStep
        position={capture(PROOF)}
        client={api.client}
        onSubmitted={vi.fn(() => Promise.resolve())}
      />,
    );

    await userEvent.upload(
      screen.getByLabelText('Choose a file of your document'),
      pdfFile('كشف-حساب.pdf'),
    );

    const names = [...document.querySelectorAll('bdi')].map((bdi) => bdi.textContent);
    expect(names).toContain('كشف-حساب.pdf');
  });
});

describe('formatting with the full requested tag (C161.2)', () => {
  it('writes a document size limit in the digits of ar-EG', () => {
    const i18n = createI18n('ar', { requested: ['ar-EG'] });
    const api = new FakeFlowApi();
    render(
      <I18nextProvider i18n={i18n}>
        {/* The app provides the requested tags (the URL's, then the browser's) to every component. */}
        <RequestedLanguagesContext value={['ar-EG']}>
          <FlowEnvironmentProvider value={FAST_POLLING}>
            <DocumentStep
              position={capture(PROOF)}
              client={api.client}
              onSubmitted={vi.fn(() => Promise.resolve())}
            />
          </FlowEnvironmentProvider>
        </RequestedLanguagesContext>
      </I18nextProvider>,
    );

    expect(screen.getByText(/١٠/u)).toBeInTheDocument();
  });
});
