import type { Db, Keyring } from '@openverify/db';
import type { OperatorAuth } from '../../operator-auth/index.js';
import type { CaseRenditionQueue, FileStorage } from '../../ports.js';

/** What every dashboard route plugin receives, with the defaults already applied. */
export interface DashboardContext {
  db: Db;
  storage: FileStorage;
  operatorAuth: OperatorAuth;
  /** The keyring that unwraps file data keys, resolved when a file is read. */
  keyring: () => Keyring;
  /**
   * C135.3 (Workflow 8B (F)): the `case-rendition` producer, through which an inquiry file's first
   * rendition request is enqueued; without it the route can only answer what is made already.
   */
  caseRenditions?: CaseRenditionQueue | undefined;
}
