/**
 * C128.7 (V07; Workflow 8B): what publish says of a contest route that names a case template, joined
 * to the contest-route rule of `workflows/publish/rules.ts`. Owner `api-case-workflows`.
 *
 * `POST /inquiries/:id/review-requests` opens that case now, so the refusal Workflow 8A held is
 * lifted. What the route still needs is checked elsewhere: the template is a reference
 * (`references.ts`), so publish refuses one the environment does not hold active, and the route's
 * schema refuses a template alone, because a template does not reach the person (C128.3).
 */
import type { DefinitionIssue } from '@openverify/workflow-engine';

/** No issue of its own: a contest route may name a case template beside its URL or contact. */
export const caseTemplateContestRouteIssues: (
  pointer: string,
  caseTemplateId: string,
) => readonly DefinitionIssue[] = () => [];
