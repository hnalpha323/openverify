/**
 * Workflow 9A Stage 1b, checkpoint (H) (C160.9; V15): the flow's theme slot. `app.tsx` provides
 * `applySessionTheme` (a no-op stub in `src/theme/apply.ts` until `api-themes` builds it in 9B),
 * bound to the page's `style-variant`, to whatever renders a session.
 */
import type { FlowSessionResponse } from '@openverify/contracts';
import { render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { createI18n } from './i18n/create-i18n';
import * as apply from './theme/apply';
import { useApplySessionTheme } from './theme/session-theme';
import { flowSession } from './testing/flow-fixtures';

vi.mock('./theme/apply', { spy: true });

const SESSION: FlowSessionResponse = flowSession({});

// In place of the renderer: it applies the theme of the session it read.
vi.mock('./routes', () => ({
  FlowRoutes: () => {
    const applyTheme = useApplySessionTheme();
    useEffect(() => {
      applyTheme(SESSION);
    }, [applyTheme]);
    return null;
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('the theme slot (C160.9)', () => {
  it('lets the renderer apply each session’s theme with the page’s style variant, none by default', () => {
    render(
      <App
        i18n={createI18n('en')}
        bootstrap={{ status: 'error', reason: 'missing' }}
        apiBaseUrl=""
      />,
    );

    expect(apply.applySessionTheme).toHaveBeenCalledWith(SESSION, null);
  });

  it('passes the style variant it is given', () => {
    render(
      <App
        i18n={createI18n('en')}
        bootstrap={{ status: 'error', reason: 'missing' }}
        apiBaseUrl=""
        styleVariant="dark"
      />,
    );

    expect(apply.applySessionTheme).toHaveBeenCalledWith(SESSION, 'dark');
  });
});
