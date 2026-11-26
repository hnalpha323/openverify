/**
 * C161.2 (Workflow 9A, flow-renderer): the languages the person may choose among: every built-in
 * language until a session says otherwise, then only the version's `enabled-locales`. The renderer
 * reports them; the layout's selector, in the fixed slot after every step, offers only those.
 */
import { createContext } from 'react';
import type { SupportedLanguage } from '../i18n/languages';

/** Reports the session's enabled languages (`null`: every built-in language). */
export type ReportLanguages = (languages: readonly SupportedLanguage[] | null) => void;

export const FlowLanguagesContext = createContext<ReportLanguages>(() => undefined);
