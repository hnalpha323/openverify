/**
 * C97.2, C99.3 (Workflow 7B): the list, item and match resources from their rows. A redacted item's
 * values read `null`; every value but the country code is masked without `pii:view` (C97.6).
 */
import {
  buildListItemResource,
  buildListMatchResource,
  buildListResource,
  listLimitsMeta,
  type ListDocument,
  type ListItemResource,
  type ListMatchResource,
} from '@openverify/contracts';
import { toImporterResourceType, type ListKind } from '@openverify/core';
import type { ListItem, ListMatch, ListRow } from '@openverify/db';
import { UNMASKED, type PiiMask } from '../../auth/pii.js';

const present = (value: unknown): unknown => value ?? null;

/** C97.2: what only `list`'s kind serves. */
function listKindAttributes(list: ListRow): Record<string, unknown> {
  switch (list.type) {
    case 'government-id-number':
      return { 'use-for-compromised-ids': list.useForCompromisedIds };
    case 'field':
      return { 'field-key': list.fieldKey };
    case 'name':
      return { 'allow-fuzzy-name-first': list.allowFuzzyNameFirst };
    case 'phone-number':
      return { 'default-region': list.defaultRegion };
    case 'string':
      return { 'case-sensitive': list.caseSensitive };
    default:
      return {};
  }
}

export function listResource(list: ListRow) {
  return buildListResource({
    id: list.id,
    kind: list.type,
    name: list.name,
    status: list.status,
    archivedAt: list.archivedAt,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
    itemCount: list.itemCount,
    version: list.version,
    purpose: list.purpose,
    itemRetentionDays: list.itemRetentionDays,
    screenAtCompletion: list.screenAtCompletion,
    attributes: listKindAttributes(list),
  });
}

/** A list document, with the kind's limits in `meta` (C97.5). */
export function listDocument(list: ListRow): ListDocument {
  return { data: listResource(list), meta: listLimitsMeta(list.type) };
}

/** C97.1: what `item`'s kind serves, the values `null` once redacted. */
function itemAttributes(kind: ListKind, item: ListItem): Record<string, unknown> {
  const value = item.value ?? {};
  switch (kind) {
    case 'browser-fingerprint':
    case 'device-fingerprint':
      return { value: present(value.value), 'key-id': item.keyId };
    case 'country':
      return { 'country-code': item.countryCode };
    case 'email-address':
      return { value: present(value.value), 'match-type': value['match-type'] ?? 'email_address' };
    case 'face':
      return {
        model: item.biometric?.model ?? null,
        'source-inquiry-id': item.biometric?.sourceInquiryId ?? null,
      };
    case 'geolocation':
      return {
        latitude: present(value.latitude),
        longitude: present(value.longitude),
        'radius-meters': present(value['radius-meters']),
      };
    case 'government-id-number':
      return { 'id-number': present(value['id-number']), 'id-class': present(value['id-class']) };
    case 'field':
      return { 'field-value': present(value['field-value']) };
    case 'name':
      return {
        'name-first': present(value['name-first']),
        'name-last': present(value['name-last']),
      };
    case 'selfie-background':
      return { 'source-inquiry-id': item.biometric?.sourceInquiryId ?? null };
    case 'ip-address':
    case 'phone-number':
    case 'string':
      return { value: present(value.value) };
  }
}

/** C97.2: who created the item, in the relationship's shape. */
function creatorOf(item: ListItem) {
  const { createdByType: type, createdById: id } = item;
  if (type === null || id === null) {
    return null;
  }
  return type === 'importer' ? { type: toImporterResourceType(item.listKind), id } : { type, id };
}

export function listItemResource(item: ListItem, mask: PiiMask): ListItemResource {
  const built = buildListItemResource({
    id: item.id,
    kind: item.listKind,
    listId: item.listId,
    status: item.status,
    archivedAt: item.archivedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    redactedAt: item.redactedAt,
    matchCount: item.matchCount,
    creator: creatorOf(item),
    attributes: itemAttributes(item.listKind, item),
  });
  return { ...built, attributes: mask.attributes(built.attributes) } as ListItemResource;
}

/** The match's record; an event builds it with `matchedValue` and `reason` `null` (rule 11). */
export function listMatchResource(
  match: ListMatch,
  listKind: ListKind,
  mask: PiiMask,
): ListMatchResource {
  const built = buildListMatchResource({
    id: match.id,
    status: match.status,
    source: match.source,
    method: match.method,
    tier: match.tier,
    confidence: match.confidence,
    approximate: match.approximate,
    score: match.score,
    distanceMeters: match.distanceMeters,
    listVersion: match.listVersion,
    matchedValue: match.matchedValue,
    dismissedAt: match.dismissedAt,
    reason: match.reason,
    createdAt: match.createdAt,
    redactedAt: match.redactedAt,
    listKind,
    listId: match.listId,
    listItemId: match.listItemId,
    inquiryId: match.inquiryId,
    accountId: match.accountId,
  });
  return { ...built, attributes: mask.attributes(built.attributes) };
}

/** The payload of `list-match.created`: no compared value, no reason (C107.5, rule 11). */
export function listMatchEventPayload(match: ListMatch, listKind: ListKind) {
  return {
    data: listMatchResource({ ...match, matchedValue: null, reason: null }, listKind, UNMASKED),
  };
}
