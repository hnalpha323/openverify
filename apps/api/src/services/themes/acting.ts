/**
 * C160 (`api-themes`, Workflow 9B): who acts on a theme set or asset, and the documents the routes
 * answer.
 */
import type { AuditActor, ThemeAssetResource } from '@openverify/contracts';
import type { ServiceContext } from '../../ports.js';

/** The caller: its tenant and request metadata, its audit actor, and its user when it is one. */
export interface ThemeActing {
  ctx: ServiceContext;
  actor: AuditActor;
  /** The user's id, or `null` for an API key (a font's licence is attested by a user). */
  userId: string | null;
}

export interface ThemeAssetDocument {
  data: ThemeAssetResource;
}
