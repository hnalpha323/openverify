/**
 * C81: the `adverse-media` report job (Workflow 6A Stage 3, owner `api-providers`), behind the
 * frozen `ReportTypeJob` of `jobs/report-types/index.ts`: a person's names screened against the
 * `adverseMedia` provider's titles (`media-screening.ts`).
 */
import type { ReportTypeJob } from './job.js';
import { runMediaScreening } from './media-screening.js';

export const adverseMediaReportJob: ReportTypeJob = {
  type: 'adverse-media',
  run: (ctx) => runMediaScreening(ctx, 'person'),
};
