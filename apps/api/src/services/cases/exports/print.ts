/**
 * C138.3 (Workflow 8B): `POST /cases/:id/print` writes its audit entry and history row and fires
 * `case.print-initiated` before the browser prints, in one transaction. Owner `api-case-files`. It
 * changes nothing else on the case (no `lock-version`), and a redacted case prints too, as redacted
 * (C138.4); a case the caller may not see reads as one that does not exist (404, C129.4). There is no
 * server-made PDF (decision 72).
 */
import type { CaseDocument, printCaseBodySchema } from '@openverify/contracts';
import { appendCaseHistory } from '@openverify/db';
import type { z } from 'zod';
import type { ApiDependencies } from '../../context.js';
import { caseFileAudit } from '../attachments/audit.js';
import { caseDocumentWithAttachments } from '../attachments/resources.js';
import type { CaseActing } from '../service.js';
import { caseChange, requireVisibleCase } from '../shared.js';
import { emitCaseEvent } from '../writes.js';

export const printCase: (
  deps: ApiDependencies,
  acting: CaseActing,
  caseId: string,
  body: z.infer<typeof printCaseBodySchema>,
) => Promise<CaseDocument> = async (deps, acting, caseId) => {
  await requireVisibleCase(deps.db, acting, caseId);
  await caseChange(deps, acting, async (unit) => {
    await appendCaseHistory(unit.tx, acting.ctx.environmentId, [
      {
        caseId,
        kind: 'print-initiated',
        actorType: acting.actor.type,
        actorId: acting.actor.id,
        requestId: acting.ctx.requestId ?? null,
      },
    ]);
    await unit.audit(caseFileAudit('case.print-initiated', caseId, {}));
    await emitCaseEvent(unit, caseId, 'case.print-initiated');
  });
  return caseDocumentWithAttachments(deps, acting, caseId);
};
