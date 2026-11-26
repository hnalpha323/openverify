import { render, type RenderResult } from '@testing-library/react';
import type { i18n } from 'i18next';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { FlowEnvironmentProvider, type FlowEnvironment } from './flow/flow-environment';
import { createI18n } from './i18n/create-i18n';
import type { SupportedLanguage } from './i18n/languages';

/** Renders a component with a real, isolated i18n instance in the given language. */
export function renderWithI18n(
  ui: ReactElement,
  language: SupportedLanguage = 'en',
): RenderResult & { i18n: i18n } {
  const instance = createI18n(language);
  return { i18n: instance, ...render(<I18nextProvider i18n={instance}>{ui}</I18nextProvider>) };
}

/** Polling fast enough for tests that wait on real timers. */
export const FAST_POLLING: Pick<FlowEnvironment, 'pollIntervalMs' | 'maxPolls'> = {
  pollIntervalMs: 1,
  maxPolls: 50,
};

/** Renders a flow component with i18n and a test environment (camera, polling). */
export function renderWithFlow(
  ui: ReactElement,
  {
    language = 'en',
    environment = {},
  }: { language?: SupportedLanguage; environment?: Partial<FlowEnvironment> } = {},
): RenderResult & { i18n: i18n } {
  return renderWithI18n(
    <FlowEnvironmentProvider value={{ ...FAST_POLLING, ...environment }}>
      {ui}
    </FlowEnvironmentProvider>,
    language,
  );
}
