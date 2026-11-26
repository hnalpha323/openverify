import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/locales/en';
import { renderWithI18n } from '../test-utils';
import { SessionEndedScreen } from './session-ended-screen';

describe('SessionEndedScreen (C19)', () => {
  it.each([
    ['session-expired', en.ended.expired],
    ['session-canceled', en.ended.canceled],
    ['redacted', en.ended.redacted],
    // C25.8: a session canceled because its inquiry expired shows the link-expired screen.
    ['inquiry-expired', en.expired],
  ] as const)('explains a %s session, with no way to retry', (outcome, copy) => {
    renderWithI18n(<SessionEndedScreen outcome={outcome} />);

    expect(screen.getByRole('heading', { level: 1, name: copy.title })).toBeVisible();
    expect(screen.getByText(copy.message)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('is translated', () => {
    renderWithI18n(<SessionEndedScreen outcome="session-expired" />, 'es');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Tu sesión de verificación ha caducado' }),
    ).toBeVisible();
  });
});
