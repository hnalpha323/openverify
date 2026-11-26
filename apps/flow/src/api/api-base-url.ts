/**
 * `VITE_OPENVERIFY_API_URL`, parsed. The parsing moved to the dependency-free
 * `src/security/csp-policy.ts` (Workflow 9A Stage 1b (F)), which the flow server shares; this module
 * keeps the flow's import path.
 */
export { apiOrigin, parseApiBaseUrl } from '../security/csp-policy';
