/** A trigger file as a run's step list includes it (C112.1): its name is masked like any value. */
import type { WorkflowRunFileResource } from '@openverify/contracts';

export interface WorkflowRunFileRecord {
  id: string;
  filename: string | null;
  mimeType: string;
  byteSize: number;
  createdAt: Date;
}

export const buildWorkflowRunFileResource = (
  record: WorkflowRunFileRecord,
): WorkflowRunFileResource => ({
  type: 'workflow-run-file',
  id: record.id,
  attributes: {
    filename: record.filename,
    'mime-type': record.mimeType,
    'byte-size': record.byteSize,
    'created-at': record.createdAt.toISOString(),
  },
});
