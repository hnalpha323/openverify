/**
 * C160.9 (Workflow 9A Stage 1b (H)): how the flow reaches `applySessionTheme` once it has a session.
 * `app.tsx` provides the call, bound to the page's `style-variant`; the renderer
 * (`flow-renderer`) calls `useApplySessionTheme()(session)` with each session it reads. Frozen
 * through 9A with the rest of `src/theme/` (V15).
 */
import type { FlowSessionResponse } from '@openverify/contracts';
import { createContext, useContext } from 'react';
import type { ApplyThemeOptions } from './apply';

/**
 * Applies a session's theme to the page; outside a provider, nothing. The renderer passes the
 * loader that reads the session's theme assets (Workflow 9B).
 */
export type ApplySessionTheme = (session: FlowSessionResponse, options?: ApplyThemeOptions) => void;

export const SessionThemeContext = createContext<ApplySessionTheme>(() => undefined);

/** The page's `applySessionTheme`, bound to its `style-variant`. */
export function useApplySessionTheme(): ApplySessionTheme {
  return useContext(SessionThemeContext);
}
