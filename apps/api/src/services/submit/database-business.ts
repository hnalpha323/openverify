/**
 * C52.6, C54.1: the `database-business` submit: the body carries no type member, and the values
 * must have been entered first (`POST /verifications/:id/inputs`, else 409 `inputs_required`). The
 * inputs route already refused a body without the inputs every match group names, and persons a
 * step does not collect (C52.3), so entered values are complete; the job judges them
 * (`jobs/types/database-business.ts`). Pinned by `routes/flow/phase5-submit.test.ts`.
 */
import { standardSubmitGuard } from './standard.js';

export const databaseBusinessSubmit = standardSubmitGuard({ inputs: true });
