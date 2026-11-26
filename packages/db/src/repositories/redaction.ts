/**
 * C16 redaction helpers. `RedactionService` (API) calls them and deletes the storage
 * objects; together they remove every stored copy of a subject's PII:
 *
 * | Table | What happens |
 * |---|---|
 * | `inquiries` | `fields` -> `{}`, `note` -> null, `redacted_at` set (kept on re-runs) |
 * | `accounts` | `fields` -> null, `redacted_at` set; the accounts consolidated into it are named for redaction |
 * | `inquiry_sessions` | `ip`, `user_agent`, `location` -> null; consent `ip`, `user_agent` -> null; the derived network facts stay (C91.4) |
 * | `networks` | `ip`, `location` -> null; country, ASN, flags, reasons and sources stay (C91.4); their ids join the stubbed and forgotten objects (C107.5) |
 * | `network_sources`, `network_syncs` | nothing: install-wide public publications, never about a subject (C92) |
 * | `inquiry_session_signals` | `components`, `behaviour` -> null; the sequence, screen, platform and collector version stay (C91.4) |
 * | `session_devices` | the sessions' links deleted (C91.4) |
 * | `devices` | each device left with no session link deleted, its HMACs with it; the ids of every device unlinked join the stubbed and forgotten objects (C91.4, C107.5) |
 * | `inquiry_signal_computations` | nothing: states, counts and codes only |
 * | `inquiries.signals`, `signal_details` | kept: counts, levels, a country code and distances, no PII (C90.5) |
 * | `inquiries.initial_fields` | -> null (C149.4, C174.5) |
 * | `inquiry_flow_steps`, `inquiry_flow_actions`, `inquiry_flow_signal_snapshots` | deleted (C151.1, C152.8, C150.9, C174.5); the API lists the action rows' account copy targets before (`flowActionCopyTargets`, V08) |
 * | `inquiry_integrity_challenges`, `inquiry_integrity_verdicts` | deleted, the sealed token and verdict with them (C221.3, Workflow 10B) |
 * | `list_matches` | `matched_value`, `reason` -> null, `redacted_at` set; their ids join the stubbed and forgotten objects (C98.4, C107.5) |
 * | `list_screenings` | nothing: states, counts, list ids and closed reasons only (C99.4) |
 * | `list_item_faces`, `list_item_backgrounds` | the items whose source the inquiry was: redacted through the API's `BiometricItemRedactor` (C98.4, C99.7) |
 * | `transactions`, `transaction_*` | nothing here: `redactTransactionRecords`, by `DELETE /transactions/:id` or `transaction-retention-days`, and with their inquiry or account since K7B-1 (owner decision 1 after Workflow 7B): the API's `services/redaction.ts` reaches every transaction naming the inquiry or one of its verifications, and every transaction attached or related to the account, through `redactTransactionInTx`, as the system |
 * | `transaction_children` | the objects a run created for a transaction: redacted with it (C127.7, `workflows/actions/transactions/children.ts`), never its `transaction_objects` (C105.5) |
 * | `workflow_runs`, `workflow_run_steps` | the runs that recorded the subject: sealed columns nulled, an unfinished run ended `subject_redacted`, its scheduled runs canceled (C120.9, `workflows/runs/redaction.ts`) |
 * | `inquiry_decisions` | the records stay; their comments go (C128.1, V25, `services/decisions/redaction.ts`) |
 * | `cases`, `case_comments`, `case_attachments`, `file_renditions`, `rendition_pages` | a case's own redaction (`DELETE /cases/:id`, retention): comments, sealed fields, tags and attachments, their objects and rendition pages after the commit (C139.1, `services/cases/redaction.ts`); a held object's redaction never redacts its case (C139.2), and discards the renditions of its files (C135.3, P22) |
 * | `lists`, `list_items`, `list_item_keys`, `list_item_ip_ranges`, `list_item_geo`, `importers`, `list_import_rows`, `list_import_errors` | nothing here: third-party list data, redacted by `item-retention-days` or with the list (C98.4); an importer's rows are deleted when it ends (C100.2) |
 * | `verification_checks` | `metadata` -> `{}`, `reasons` -> `{}` |
 * | `government_id_extractions` | `fields`, `identification_number_index`, `front_phash` (and its bands) -> null, `redacted_at` set (C31.7) |
 * | `files` | returned until marked `deleted_at` (`markFilesDeleted`, after storage delete) |
 * | `selfie_captures` | `device` -> null, `redacted_at` set; their ids join the stubbed and forgotten objects (C40.1) |
 * | `verification_inputs` | `values` -> null, `redacted_at` set; the field names and source stay (C53.6) |
 * | `otp_challenges` | `destination`, `destination_index`, `code_hmac`, `provider_message_id` -> null, `redacted_at` set (C53.6) |
 * | `otp_verification_states` | nothing: counts and a reason only (C53.2) |
 * | `crypto_challenges` | `wallet_address`, `address_index`, `message`, `signature`, `signed_message` -> null, `redacted_at` set (C53.6) |
 * | `document_extractions` | `fields` -> null, `redacted_at` set; the class, confidence, page count and media type stay (C53.6) |
 * | `chip_challenges` | `aa_response`, `device_report` -> null, `redacted_at` set; the nonce digest stays (C53.6) |
 * | `chip_reads` | `fields`, `sod_signature`, `sod_signature_index`, `document_number_index`, `issuing_country` -> null, `redacted_at` set; the PA summary stays (C53.6) |
 * | `business_registry_records` | `record` -> null, `redacted_at` set; the source and fetch time stay (C53.6) |
 * | `trust_*` | nothing: install-wide public-sector PKI data, never about a subject (C53.3) |
 * | `reports` | their events stubbed and their stored API copies cleared with the inquiry's or the account's (home or `report_accounts`); `query`, `result`, `crypto_address_index` -> null, `redacted_at` set by `api-reports`' `redactReportInTx` (C73.5) |
 * | `report_matches` | `snapshot`, `entry_index`, `evidence_hash` -> null; `source_id`, scores and statuses stay (C73.5, `redactReportInTx`) |
 * | `report_actions` | `details` -> null under `openverify.report_redaction` (the trigger's redaction case; C73.2, C73.5) |
 * | `report_runs`, `report_accounts`, `report_templates`, `report_template_versions` | nothing: codes, counts, ids and configuration only |
 * | `watchlist_*` | nothing: install-wide list data, never about a subject (C73.3; C76.8 limits it) |
 * | `face_templates` | deleted (C42.6) |
 * | `selfie_backgrounds` | deleted (C42.6) |
 * | `events` | payloads of the object, its verifications and sessions -> the C16 stub |
 * | `api_logs` | `query`, `request_body`, `response_body` of requests about or mentioning them -> null |
 * | `idempotency_keys` | stored responses about or mentioning them deleted |
 *
 * `inquiries.fields` is NOT NULL since Phase 1, so it becomes an empty object rather than
 * null: it carries no PII either way. Every helper is idempotent.
 */
import { and, arrayOverlaps, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  accounts,
  apiLogs,
  devices,
  events,
  files,
  idempotencyKeys,
  inquiries,
  inquiryFlowActions,
  inquiryFlowSignalSnapshots,
  inquiryFlowSteps,
  inquiryIntegrityChallenges,
  inquiryIntegrityVerdicts,
  inquirySessionSignals,
  inquirySessions,
  listMatches,
  networks,
  reportAccounts,
  reports,
  selfieCaptures,
  sessionDevices,
  verificationChecks,
  verifications,
  type Account,
  type Inquiry,
  type StoredFile,
} from '../schema.js';
import { toAccount } from './accounts.js';
import { redactBusinessRegistryRecords } from './business-registry-records.js';
import { redactChipChallenges } from './chip-challenges.js';
import { redactChipReads } from './chip-reads.js';
import { redactCryptoChallenges } from './crypto-challenges.js';
import { redactDocumentExtractions } from './document-extractions.js';
import { redactGovernmentIdExtractions } from './government-id-extractions.js';
import { redactOtpChallenges } from './otp-challenges.js';
import { redactVerificationInputs } from './verification-inputs.js';
import { toInquiry } from './inquiries.js';
import { deleteFaceDataForInquiry } from './selfie-captures.js';
import { firstOrNull, inserted } from './rows.js';

export interface RedactOptions {
  /** The redaction time of a first redaction; defaults to now. */
  at?: Date;
}

export interface InquiryRedaction {
  inquiry: Inquiry;
  /** The inquiry was already redacted; `redactedAt` keeps the first time. */
  alreadyRedacted: boolean;
  /**
   * Files not yet marked deleted: delete their objects from storage, then call
   * `markFilesDeleted`. A re-run returns those a failed run left behind.
   */
  files: StoredFile[];
  /** Event payloads replaced by the C16 stub in this call. */
  stubbedEvents: number;
}

export interface AccountRedaction {
  account: Account;
  alreadyRedacted: boolean;
  /** C16: redacting an account redacts its inquiries too; redact each of these. */
  inquiryIds: string[];
  /**
   * The accounts consolidated into this one (C13 `consolidated-into`), sorted. They keep their
   * own fields and events, which are the same person's: redact each of these too (Workflow 2B
   * F007).
   */
  consolidatedAccountIds: string[];
  stubbedEvents: number;
}

/**
 * Replaces the payload of every unredacted event about these objects with the C16 stub
 * `{ data: { type, id, attributes: { redacted-at } } }`. Returns how many changed.
 */
export async function stubEventPayloads(
  db: Db,
  environmentId: string,
  objectIds: readonly string[],
  at: Date,
): Promise<number> {
  if (objectIds.length === 0) {
    return 0;
  }
  const targets = await db
    .selectDistinct({ objectId: events.objectId, objectType: events.objectType })
    .from(events)
    .where(
      and(
        eq(events.environmentId, environmentId),
        inArray(events.objectId, [...objectIds]),
        isNull(events.redactedAt),
      ),
    );
  let stubbed = 0;
  for (const { objectId, objectType } of targets) {
    if (objectId === null) {
      continue;
    }
    const rows = await db
      .update(events)
      .set({
        payload: {
          data: {
            type: objectType ?? 'unknown',
            id: objectId,
            attributes: { 'redacted-at': at.toISOString() },
          },
        },
        redactedAt: at,
      })
      .where(
        and(
          eq(events.environmentId, environmentId),
          eq(events.objectId, objectId),
          isNull(events.redactedAt),
        ),
      )
      .returning({ id: events.id });
    stubbed += rows.length;
  }
  return stubbed;
}

/**
 * Clears the stored bodies of API logs and idempotent responses that are about these objects
 * or mention them anywhere (`subject_ids`): list answers, event reads and other embeddings
 * keep PII under another resource id, or none (Workflow 2B F005, F017). Exported for a report
 * redacted on its own (`forgetReportCopies`, K6A-12).
 */
export async function forgetStoredResponses(
  db: Db,
  environmentId: string,
  objectIds: readonly string[],
): Promise<void> {
  const ids = [...objectIds];
  await db
    .update(apiLogs)
    .set({ querySealed: null, requestBodySealed: null, responseBodySealed: null })
    .where(
      and(
        eq(apiLogs.environmentId, environmentId),
        or(inArray(apiLogs.resourceId, ids), arrayOverlaps(apiLogs.subjectIds, ids)),
      ),
    );
  await db
    .delete(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.environmentId, environmentId),
        or(
          inArray(idempotencyKeys.resourceId, ids),
          arrayOverlaps(idempotencyKeys.subjectIds, ids),
        ),
      ),
    );
}

/**
 * C16 `redactInquiry` (database part), in one transaction with the inquiry locked. `null`
 * when the inquiry is not in this environment.
 */
export async function redactInquiryRecords(
  db: Db,
  environmentId: string,
  inquiryId: string,
  options: RedactOptions = {},
): Promise<InquiryRedaction | null> {
  return db.transaction(async (tx) => {
    const current = firstOrNull(
      await tx
        .select({ redactedAt: inquiries.redactedAt })
        .from(inquiries)
        .where(and(eq(inquiries.id, inquiryId), eq(inquiries.environmentId, environmentId)))
        .for('update'),
    );
    if (current === null) {
      return null;
    }
    const at = current.redactedAt ?? options.at ?? new Date();
    const inquiry = toInquiry(
      inserted(
        await tx
          .update(inquiries)
          .set({ fields: {}, noteSealed: null, initialFieldsSealed: null, redactedAt: at })
          .where(and(eq(inquiries.id, inquiryId), eq(inquiries.environmentId, environmentId)))
          .returning(),
        'redactInquiryRecords',
      ),
    );
    // C151.1, C152.8, C150.9, C174.5 (Workflow 9A): the flow engine's records go with the inquiry,
    // also on a re-run. The API reads the action rows' copy targets first (`flowActionCopyTargets`).
    await deleteInquiryFlowRecordsInTx(tx, environmentId, [inquiryId]);
    // C221.3 (Workflow 10B): the integrity challenges, any token not yet decoded, and the verdict.
    await deleteInquiryIntegrityRecordsInTx(tx, environmentId, [inquiryId]);
    const sessions = await tx
      .update(inquirySessions)
      .set({
        ipSealed: null,
        userAgentSealed: null,
        locationSealed: null,
        consent: sql`case when ${inquirySessions.consent} is null then null
          else ${inquirySessions.consent} || '{"ip": null, "user_agent": null}'::jsonb end`,
      })
      .where(
        and(
          eq(inquirySessions.environmentId, environmentId),
          eq(inquirySessions.inquiryId, inquiryId),
        ),
      )
      .returning({ id: inquirySessions.id });
    // C91.4: each session's network evaluation loses its address and location; the derived facts
    // (country, ASN, flags, reasons, sources) stay.
    const networkIds =
      sessions.length === 0
        ? []
        : (
            await tx
              .update(networks)
              .set({ ipSealed: null, locationSealed: null })
              .where(
                and(
                  eq(networks.environmentId, environmentId),
                  inArray(
                    networks.inquirySessionId,
                    sessions.map((session) => session.id),
                  ),
                ),
              )
              .returning({ id: networks.id })
          ).map((row) => row.id);
    const sessionIds = sessions.map((session) => session.id);
    // C91.4: the collector's components and aggregates go; the session's device links go, and a
    // device with no session left goes with its HMACs.
    const deviceIds: string[] = [];
    if (sessionIds.length > 0) {
      await tx
        .update(inquirySessionSignals)
        .set({ componentsSealed: null, behaviourSealed: null })
        .where(
          and(
            eq(inquirySessionSignals.environmentId, environmentId),
            inArray(inquirySessionSignals.inquirySessionId, sessionIds),
          ),
        );
      const unlinked = await tx
        .delete(sessionDevices)
        .where(
          and(
            eq(sessionDevices.environmentId, environmentId),
            inArray(sessionDevices.inquirySessionId, sessionIds),
          ),
        )
        .returning({ deviceId: sessionDevices.deviceId });
      deviceIds.push(...new Set(unlinked.map((link) => link.deviceId)));
      if (deviceIds.length > 0) {
        await tx.delete(devices).where(
          and(
            eq(devices.environmentId, environmentId),
            inArray(devices.id, deviceIds),
            sql`not exists (select 1 from ${sessionDevices}
                   where ${sessionDevices.environmentId} = ${devices.environmentId}
                     and ${sessionDevices.deviceId} = ${devices.id})`,
          ),
        );
      }
    }
    const verificationIds = (
      await tx
        .select({ id: verifications.id })
        .from(verifications)
        .where(
          and(
            eq(verifications.environmentId, environmentId),
            eq(verifications.inquiryId, inquiryId),
          ),
        )
    ).map((row) => row.id);
    let remainingFiles: StoredFile[] = [];
    if (verificationIds.length > 0) {
      await tx
        .update(verificationChecks)
        .set({ metadata: {}, reasons: [] })
        .where(
          and(
            eq(verificationChecks.environmentId, environmentId),
            inArray(verificationChecks.verificationId, verificationIds),
          ),
        );
      await redactGovernmentIdExtractions(tx, environmentId, verificationIds, at);
      // C53.6: the Workflow 5A sealed values and indexes.
      await redactVerificationInputs(tx, environmentId, verificationIds, at);
      await redactOtpChallenges(tx, environmentId, verificationIds, at);
      await redactCryptoChallenges(tx, environmentId, verificationIds, at);
      // C53.6: the Workflow 5B sealed values and indexes; their files go with the files below.
      await redactDocumentExtractions(tx, environmentId, verificationIds, at);
      await redactChipChallenges(tx, environmentId, verificationIds, at);
      await redactChipReads(tx, environmentId, verificationIds, at);
      await redactBusinessRegistryRecords(tx, environmentId, verificationIds, at);
      remainingFiles = await tx
        .select()
        .from(files)
        .where(
          and(
            eq(files.environmentId, environmentId),
            inArray(files.verificationId, verificationIds),
            isNull(files.deletedAt),
          ),
        );
    }
    // C40.1, C42.6: the captures keep no device, and the face data goes.
    const captures = await tx
      .update(selfieCaptures)
      .set({
        deviceSealed: null,
        redactedAt: sql`coalesce(${selfieCaptures.redactedAt}, ${at.toISOString()}::timestamptz)`,
      })
      .where(
        and(
          eq(selfieCaptures.environmentId, environmentId),
          eq(selfieCaptures.inquiryId, inquiryId),
        ),
      )
      .returning({ id: selfieCaptures.id });
    await deleteFaceDataForInquiry(tx, environmentId, inquiryId);
    // C98.4 (Workflow 7B): the inquiry's list matches lose the compared value and the reason.
    const listMatchIds = (
      await tx
        .update(listMatches)
        .set({
          matchedValueSealed: null,
          reasonSealed: null,
          redactedAt: sql`coalesce(${listMatches.redactedAt}, ${at.toISOString()}::timestamptz)`,
        })
        .where(
          and(eq(listMatches.environmentId, environmentId), eq(listMatches.inquiryId, inquiryId)),
        )
        .returning({ id: listMatches.id })
    ).map((row) => row.id);
    // C73.5: the inquiry's reports; their rows are redacted by the report redaction hook.
    const reportIds = (
      await tx
        .select({ id: reports.id })
        .from(reports)
        .where(and(eq(reports.environmentId, environmentId), eq(reports.inquiryId, inquiryId)))
    ).map((row) => row.id);
    const objectIds = [
      inquiryId,
      ...verificationIds,
      ...sessions.map((session) => session.id),
      ...networkIds,
      ...deviceIds,
      ...captures.map((capture) => capture.id),
      ...listMatchIds,
      ...reportIds,
    ];
    const stubbedEvents = await stubEventPayloads(tx, environmentId, objectIds, at);
    await forgetStoredResponses(tx, environmentId, objectIds);
    return {
      inquiry,
      alreadyRedacted: current.redactedAt !== null,
      files: remainingFiles,
      stubbedEvents,
    };
  });
}

/**
 * C16 `redactAccount` (database part): the account's fields and the copies of them, in
 * one transaction. The caller then redacts each of `inquiryIds`. `null` when the account
 * is not in this environment.
 */
export async function redactAccountRecords(
  db: Db,
  environmentId: string,
  accountId: string,
  options: RedactOptions = {},
): Promise<AccountRedaction | null> {
  return db.transaction(async (tx) => {
    const current = firstOrNull(
      await tx
        .select({ redactedAt: accounts.redactedAt })
        .from(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.environmentId, environmentId)))
        .for('update'),
    );
    if (current === null) {
      return null;
    }
    const at = current.redactedAt ?? options.at ?? new Date();
    const account = toAccount(
      inserted(
        await tx
          .update(accounts)
          .set({ fieldsSealed: null, redactedAt: at })
          .where(and(eq(accounts.id, accountId), eq(accounts.environmentId, environmentId)))
          .returning(),
        'redactAccountRecords',
      ),
    );
    // C73.5: the reports the account holds, home or linked (`report_accounts`).
    const reportIds = (
      await tx
        .select({ id: reports.id })
        .from(reports)
        .where(
          and(
            eq(reports.environmentId, environmentId),
            or(
              eq(reports.accountId, accountId),
              inArray(
                reports.id,
                tx
                  .select({ id: reportAccounts.reportId })
                  .from(reportAccounts)
                  .where(
                    and(
                      eq(reportAccounts.environmentId, environmentId),
                      eq(reportAccounts.accountId, accountId),
                    ),
                  ),
              ),
            ),
          ),
        )
    ).map((row) => row.id);
    const stubbedEvents = await stubEventPayloads(tx, environmentId, [accountId, ...reportIds], at);
    await forgetStoredResponses(tx, environmentId, [accountId, ...reportIds]);
    const inquiryIds = (
      await tx
        .select({ id: inquiries.id })
        .from(inquiries)
        .where(and(eq(inquiries.environmentId, environmentId), eq(inquiries.accountId, accountId)))
    ).map((row) => row.id);
    const consolidatedAccountIds = (
      await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(eq(accounts.environmentId, environmentId), eq(accounts.consolidatedInto, accountId)),
        )
        .orderBy(asc(accounts.id))
    ).map((row) => row.id);
    return {
      account,
      alreadyRedacted: current.redactedAt !== null,
      inquiryIds,
      consolidatedAccountIds,
      stubbedEvents,
    };
  });
}

/**
 * C151.1, C152.8, C150.9, C174.5 (Workflow 9A): deletes the flow engine's records of these
 * inquiries (their step records, action rows and signal snapshots); the inquiry's redaction calls it,
 * and the C16 pass's `deleteFlowRecordsOfRedactedInquiries` catches anything a race left. Returns
 * the rows deleted.
 */
export async function deleteInquiryFlowRecordsInTx(
  tx: Db,
  environmentId: string,
  inquiryIds: readonly string[],
): Promise<number> {
  if (inquiryIds.length === 0) {
    return 0;
  }
  const ids = [...inquiryIds];
  const snapshots = await tx
    .delete(inquiryFlowSignalSnapshots)
    .where(
      and(
        eq(inquiryFlowSignalSnapshots.environmentId, environmentId),
        inArray(inquiryFlowSignalSnapshots.inquiryId, ids),
      ),
    )
    .returning({ name: inquiryFlowSignalSnapshots.name });
  const actions = await tx
    .delete(inquiryFlowActions)
    .where(
      and(
        eq(inquiryFlowActions.environmentId, environmentId),
        inArray(inquiryFlowActions.inquiryId, ids),
      ),
    )
    .returning({ stepId: inquiryFlowActions.stepId });
  const steps = await tx
    .delete(inquiryFlowSteps)
    .where(
      and(
        eq(inquiryFlowSteps.environmentId, environmentId),
        inArray(inquiryFlowSteps.inquiryId, ids),
      ),
    )
    .returning({ seq: inquiryFlowSteps.seq });
  return snapshots.length + actions.length + steps.length;
}

/**
 * C221.3 (Workflow 10B Stage 1b (I)): deletes these inquiries' integrity challenges (with any token
 * not yet decoded) and verdicts; the inquiry's redaction calls it, and the C16 pass's
 * `deleteIntegrityRecordsOfRedactedInquiries` catches anything a race left. Returns the rows deleted.
 */
export async function deleteInquiryIntegrityRecordsInTx(
  tx: Db,
  environmentId: string,
  inquiryIds: readonly string[],
): Promise<number> {
  if (inquiryIds.length === 0) {
    return 0;
  }
  const ids = [...inquiryIds];
  const challenges = await tx
    .delete(inquiryIntegrityChallenges)
    .where(
      and(
        eq(inquiryIntegrityChallenges.environmentId, environmentId),
        inArray(inquiryIntegrityChallenges.inquiryId, ids),
      ),
    )
    .returning({ id: inquiryIntegrityChallenges.id });
  const verdicts = await tx
    .delete(inquiryIntegrityVerdicts)
    .where(
      and(
        eq(inquiryIntegrityVerdicts.environmentId, environmentId),
        inArray(inquiryIntegrityVerdicts.inquiryId, ids),
      ),
    )
    .returning({ inquiryId: inquiryIntegrityVerdicts.inquiryId });
  return challenges.length + verdicts.length;
}
