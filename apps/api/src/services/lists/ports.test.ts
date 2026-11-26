/**
 * Workflow 7B Stage 1b (L) (C99.1, F08): the in-memory fakes of the list ports, which Stage 3 agents
 * build against, and the stubs the processes use until the owners build them. A stub never reads as
 * "no match": the matcher answers every list `unscreened`, and the gate says no. Synthetic values.
 */
import { newId } from '@openverify/contracts';
import type { Db } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import { NotImplementedError } from '../../errors.js';
import {
  createFakeBiometricItemRedactor,
  createFakeBiometricListMatcher,
  createFakeBiometricListsGate,
  createFakeCompromisedIdLookup,
  createFakeListItemWriter,
  createFakeListService,
} from '../../test-support/fakes.js';
import {
  unbuiltBiometricListMatcher,
  unbuiltBiometricListsGate,
} from './biometric/index.js';
import { unbuiltCompromisedIdLookup } from './compromised-ids.js';
import { unbuiltListItemWriter, unbuiltListService } from './item-writer.js';

const db = {} as Db;
const environmentId = newId('env');
const listId = newId('lst');
const item = (value: string) => ({
  attributes: { value },
  creator: { type: 'importer' as const, id: newId('mprt') },
});

describe('the fakes (F08)', () => {
  it('writes each value once, counts a repeat, and reports refusals by position', async () => {
    const writer = createFakeListItemWriter();
    writer.refusals = [{ index: 2, code: 'invalid_value' }];

    const result = await writer.insertItems(db, {
      environmentId,
      listId,
      items: [item('a'), item('a'), item('b')],
    });

    expect(result.inserted).toHaveLength(1);
    expect(result.alreadyPresent).toBe(1);
    expect(result.refused).toEqual([{ index: 2, code: 'invalid_value' }]);
    expect(writer.written.get(listId)).toHaveLength(1);
  });

  it('creates through the list service', async () => {
    const service = createFakeListService();

    expect(await service.createItem({ environmentId, listId, item: item('a') })).toMatchObject({
      alreadyPresent: false,
    });
    expect(service.created).toHaveLength(1);
  });

  it('answers the matcher’s outcome and records the lists it was asked', async () => {
    const matcher = createFakeBiometricListMatcher();

    const outcome = await matcher.match({
      environmentId,
      inquiryId: 'inq_1',
      lists: [{ id: listId, kind: 'face', version: 1 }],
    });

    expect(outcome).toEqual({ matches: [], unscreened: [], compared: [] });
    expect(matcher.calls).toEqual([{ inquiryId: 'inq_1', listIds: [listId] }]);
  });

  it('records a redaction by source and names its objects', async () => {
    const redactor = createFakeBiometricItemRedactor();
    redactor.storageKeys = ['key'];
    const at = new Date('2026-10-31T00:00:00.000Z');

    expect(await redactor.redactBySource(db, { environmentId, inquiryId: 'inq_1', at })).toEqual({
      storageKeys: ['key'],
      changedLists: [],
      redactedItemIds: [],
    });
    expect(redactor.calls).toEqual([{ environmentId, inquiryId: 'inq_1', at }]);
  });

  it('holds the gate per environment', async () => {
    const gate = createFakeBiometricListsGate();

    expect(await gate.isAcknowledged(db, environmentId)).toBe(false);
    gate.acknowledged.add(environmentId);
    expect(await gate.isAcknowledged(db, environmentId)).toBe(true);
  });

  it('answers the lookup’s answer', async () => {
    const lookup = createFakeCompromisedIdLookup();
    lookup.answer = { matched: true, unscreened: [] };

    await expect(
      lookup.lookup({
        environmentId,
        inquiryId: 'inq_1',
        verificationId: 'ver_1',
        identificationNumber: 'X1',
        idClass: 'passport',
      }),
    ).resolves.toEqual({ matched: true, unscreened: [] });
    expect(lookup.calls).toEqual([{ identificationNumber: 'X1', idClass: 'passport' }]);
  });
});

describe('the stubs, until their owners build them', () => {
  it('never reads a biometric list as no match (H02)', async () => {
    const outcome = await unbuiltBiometricListMatcher.match({
      environmentId,
      inquiryId: 'inq_1',
      lists: [{ id: listId, kind: 'face', version: 1 }],
    });

    expect(outcome).toEqual({
      matches: [],
      unscreened: [{ 'list-id': listId, reason: 'list_items_pending' }],
      compared: [],
    });
  });

  it('keeps biometric lists closed', async () => {
    expect(await unbuiltBiometricListsGate.isAcknowledged(db, environmentId)).toBe(false);
  });

  it('leaves the check’s input absent', async () => {
    await expect(
      unbuiltCompromisedIdLookup.lookup({
        environmentId,
        inquiryId: 'inq_1',
        verificationId: 'ver_1',
        identificationNumber: 'X1',
        idClass: null,
      }),
    ).resolves.toBeNull();
  });

  it('answers 501 from the writer and the service', async () => {
    await expect(
      unbuiltListItemWriter.insertItems(db, { environmentId, listId, items: [] }),
    ).rejects.toBeInstanceOf(NotImplementedError);
    await expect(
      unbuiltListService.createItem({ environmentId, listId, item: item('a') }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });
});
