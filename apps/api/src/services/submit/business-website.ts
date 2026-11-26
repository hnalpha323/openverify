/**
 * C52.6, C54.1: the `business-website` submit: the body carries no type member, and the URL must
 * have been entered first (`POST /verifications/:id/inputs`, else 409 `inputs_required`); the job
 * judges it (`jobs/types/business-website.ts`). Pinned by `routes/flow/phase5-submit.test.ts`.
 */
import { standardSubmitGuard } from './standard.js';

export const businessWebsiteSubmit = standardSubmitGuard({ inputs: true });
