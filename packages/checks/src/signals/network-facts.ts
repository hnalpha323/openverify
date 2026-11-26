/**
 * Reading a session's stored network facts (C93.3): the null reason the network row names for a
 * fact, and the registry constants as numbers.
 */
import type { ConfigDefault } from '@openverify/core';
import type { NetworkFactField, NetworkReasonInput } from './inputs.js';
import { SIGNAL_NULL_REASONS, isGapNullReason, type SignalNullReason } from './vocabulary.js';

const NULL_REASONS: ReadonlySet<string> = new Set(SIGNAL_NULL_REASONS);

function isNullReason(reason: string): reason is SignalNullReason {
  return NULL_REASONS.has(reason);
}

/**
 * The null reason a network row names for `field`. A null fact without one reads as
 * `list_unavailable`: a gap, so a review rule's default sees it, never a silent pass.
 */
export function factNullReason(
  reasons: readonly NetworkReasonInput[],
  field: NetworkFactField,
): SignalNullReason {
  for (const { field: about, reason } of reasons) {
    if (about === field && isNullReason(reason)) {
      return reason;
    }
  }
  return 'list_unavailable';
}

/** Among competing null reasons, the first data or collection gap, else the first (C90.7). */
export function firstReason(reasons: readonly SignalNullReason[]): SignalNullReason | null {
  return reasons.find(isGapNullReason) ?? reasons[0] ?? null;
}

/** A registry constant's value as a number. */
export function constantValue(table: Readonly<Record<string, ConfigDefault>>, key: string): number {
  const value = Number(table[key]?.value);
  if (!Number.isFinite(value)) {
    throw new Error(`no numeric signal constant ${key}`);
  }
  return value;
}
