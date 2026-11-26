/**
 * Pure helpers the webhook dispatcher applies to an event payload (`{ data, included? }`)
 * before signing (contract C14): the attribute blocklist and the delivery filters.
 */

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A deep copy of `value` without any object member named in `blocked`, at any depth. */
function withoutKeys(value: unknown, blocked: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => withoutKeys(item, blocked));
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !blocked.has(key))
        .map(([key, item]) => [key, withoutKeys(item, blocked)]),
    );
  }
  return value;
}

/** A copy of a resource object whose `attributes` lost the blocked names. */
function blockResource(resource: unknown, blocked: ReadonlySet<string>): unknown {
  if (!isObject(resource)) {
    return resource;
  }
  const copy = structuredClone(resource);
  if (isObject(resource.attributes)) {
    copy.attributes = withoutKeys(resource.attributes, blocked);
  }
  return copy;
}

function blockMember(member: unknown, blocked: ReadonlySet<string>): unknown {
  return Array.isArray(member)
    ? member.map((resource) => blockResource(resource, blocked))
    : blockResource(member, blocked);
}

/**
 * Removes every attribute named in `names` from the `attributes` of each resource object in
 * `payload.data` and `payload.included`, at any depth inside `attributes`: `fields` drops the
 * whole fields object, and `metadata` drops each check's metadata. `type`, `id` and
 * `relationships` are never touched. Returns a copy; the input is not changed.
 */
export function applyAttributeBlocklist<
  Payload extends { readonly data: unknown; readonly included?: readonly unknown[] },
>(payload: Payload, names: readonly string[]): Payload {
  const blocked = new Set(names);
  const copy = structuredClone(payload) as Payload & { data: unknown; included?: unknown[] };
  copy.data = blockMember(payload.data, blocked);
  if (payload.included !== undefined) {
    copy.included = payload.included.map((resource) => blockResource(resource, blocked));
  }
  return copy;
}

/** A webhook's delivery filters (C14). An absent filter does not filter. */
export interface WebhookFilters {
  readonly 'inquiry-template-ids'?: readonly string[];
  readonly 'account-type-ids'?: readonly string[];
  /** C143.4 (Workflow 8A): a workflow, version or run event, by its workflow. */
  readonly 'workflow-ids'?: readonly string[];
  /** C143.4 (Workflow 8A): a list event, by its list. */
  readonly 'list-ids'?: readonly string[];
  /** C143.4 (Workflow 8B): a case or case-comment event, by its case's template. */
  readonly 'case-template-ids'?: readonly string[];
}

/** The attributes of an event's subject that filters compare; absent or null when unknown. */
export interface WebhookFilterSubject {
  inquiryTemplateId?: string | null;
  accountTypeId?: string | null;
  /**
   * C70.4 (F10, decision 45): a report subject is strict: without the filtered attribute it does
   * not pass a present filter. Every other subject keeps C14's rule (an absent attribute is not
   * filtered).
   */
  strict?: boolean;
  /**
   * C107.4 (Workflow 7B): the templates and account types of a subject with several links, as a
   * transaction has. It passes a filter that allows any one of them.
   */
  inquiryTemplateIds?: readonly string[];
  accountTypeIds?: readonly string[];
  /** C143.4 (Workflow 8A): a workflow, version or run event's workflow. */
  workflowId?: string | null;
  /** C143.4 (Workflow 8A): a list event's list. */
  listId?: string | null;
  /** C143.4 (Workflow 8B): a case or case-comment event's case template. */
  caseTemplateId?: string | null;
  /**
   * C143.4 (Workflow 8B): the templates of every inquiry a case holds. A case passes an
   * inquiry-template filter only when the filter allows every one of them, and with none it fails
   * that filter when strict.
   */
  heldInquiryTemplateIds?: readonly string[];
}

function linkedId(relationships: unknown, name: string): string | undefined {
  if (!isObject(relationships)) {
    return undefined;
  }
  const relationship = relationships[name];
  const linkage = isObject(relationship) ? relationship.data : undefined;
  return isObject(linkage) && typeof linkage.id === 'string' ? linkage.id : undefined;
}

/**
 * Reads the filter attributes from an event payload: the `inquiry-template` linkage of an
 * inquiry and the `account-type` linkage of an account. Other subjects carry neither.
 */
export function webhookFilterSubject(payload: unknown): WebhookFilterSubject {
  const data = isObject(payload) ? payload.data : undefined;
  const relationships = isObject(data) ? data.relationships : undefined;
  const subject: WebhookFilterSubject = {};
  const inquiryTemplateId = linkedId(relationships, 'inquiry-template');
  const accountTypeId = linkedId(relationships, 'account-type');
  if (inquiryTemplateId !== undefined) {
    subject.inquiryTemplateId = inquiryTemplateId;
  }
  if (accountTypeId !== undefined) {
    subject.accountTypeId = accountTypeId;
  }
  return subject;
}

/** A subject's values of one attribute: its single link and its list, whichever it has. */
function valuesOf(
  single: string | null | undefined,
  several: readonly string[] | undefined,
): string[] {
  return [...(single === undefined || single === null ? [] : [single]), ...(several ?? [])];
}

function passes(
  values: readonly string[],
  allowed: readonly string[] | undefined,
  strict: boolean,
): boolean {
  if (allowed === undefined) {
    return true;
  }
  if (values.length === 0) {
    // C14: an absent attribute is not filtered; C70.4: a strict (report) subject fails.
    return !strict;
  }
  return values.some((value) => allowed.includes(value));
}

/** C143.4 (Workflow 8B): every value must be allowed, and none fails a strict subject. */
function passesEvery(
  values: readonly string[],
  allowed: readonly string[] | undefined,
  strict: boolean,
): boolean {
  if (allowed === undefined) {
    return true;
  }
  if (values.length === 0) {
    return !strict;
  }
  return values.every((value) => allowed.includes(value));
}

/**
 * Whether a webhook with `filters` receives `event`: its subject must match every present
 * filter, and a subject without the filtered attribute is not filtered. `event.subject`
 * overrides what the payload carries, for example the template of a verification's inquiry.
 * An empty filter list matches no subject that has the attribute.
 */
export function matchesWebhookFilters(
  event: { readonly payload: unknown; readonly subject?: WebhookFilterSubject },
  filters: WebhookFilters,
): boolean {
  const subject = { ...webhookFilterSubject(event.payload), ...event.subject };
  return (
    // C143.4 (Workflow 8B): a case answers for every inquiry it holds, never for any one.
    (subject.heldInquiryTemplateIds === undefined
      ? passes(
          valuesOf(subject.inquiryTemplateId, subject.inquiryTemplateIds),
          filters['inquiry-template-ids'],
          subject.strict === true,
        )
      : passesEvery(
          subject.heldInquiryTemplateIds,
          filters['inquiry-template-ids'],
          subject.strict === true,
        )) &&
    passes(
      valuesOf(subject.accountTypeId, subject.accountTypeIds),
      filters['account-type-ids'],
      subject.strict === true,
    ) &&
    // C143.4 (Workflow 8A).
    passes(
      valuesOf(subject.workflowId, undefined),
      filters['workflow-ids'],
      subject.strict === true,
    ) &&
    passes(valuesOf(subject.listId, undefined), filters['list-ids'], subject.strict === true) &&
    // C143.4 (Workflow 8B).
    passes(
      valuesOf(subject.caseTemplateId, undefined),
      filters['case-template-ids'],
      subject.strict === true,
    )
  );
}
