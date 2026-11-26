/**
 * C161.2 (Workflow 9A, flow-renderer): the language tags the person asked for, in priority order
 * (the URL's `language` or `lang`, then the browser's languages), which `App` provides and the
 * renderer negotiates against the version's enabled locales once the session arrives.
 */
import { createContext } from 'react';

export const RequestedLanguagesContext = createContext<readonly string[]>([]);
