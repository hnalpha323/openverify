/**
 * C99.4, C99.7, C100.2, C107.1, C107.2 (Workflow 7B Stage 1b (L)): the `list-screen`, `list-import`
 * and `list-item-embed` queues. A job's id is its object's id; it carries ids only, and is removed
 * when it completes or fails, because the row is the record and a kept job id would make every
 * later add a no-op. Built from a connection, a producer opens its queue only on first use.
 */
import { newId } from '@openverify/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { ListImportJob, ListItemEmbedJob, ListScreenJob } from '../ports.js';
import {
  LIST_IMPORT_JOB,
  LIST_IMPORT_QUEUE,
  LIST_IMPORT_SWEEP_QUEUE,
  LIST_ITEM_EMBED_JOB,
  LIST_ITEM_EMBED_QUEUE,
  LIST_ITEM_EMBED_SWEEP_QUEUE,
  LIST_JOB_OPTIONS,
  LIST_SCREEN_JOB,
  LIST_SCREEN_QUEUE,
  LIST_SCREEN_SWEEP_QUEUE,
  LIST_SWEEP_INTERVAL_MS,
  createListImportQueue,
  createListItemEmbedQueue,
  createListScreenQueue,
} from './list-queues.js';
import { createRecordingQueue } from './testing.js';

const bull = vi.hoisted(() => ({ created: [] as string[] }));
vi.mock('./queue.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./queue.js')>();
  return {
    ...original,
    createBullQueue: (name: string) => {
      bull.created.push(name);
      return { add: () => Promise.resolve(), close: () => Promise.resolve() };
    },
  };
});

const environmentId = newId('env');

describe('the list queues (C107.2)', () => {
  it('has the names and period of the plan', () => {
    expect([LIST_SCREEN_QUEUE, LIST_IMPORT_QUEUE, LIST_ITEM_EMBED_QUEUE]).toEqual([
      'list-screen',
      'list-import',
      'list-item-embed',
    ]);
    expect([LIST_SCREEN_SWEEP_QUEUE, LIST_IMPORT_SWEEP_QUEUE, LIST_ITEM_EMBED_SWEEP_QUEUE]).toEqual(
      ['list-screen-sweep', 'list-import-sweep', 'list-item-embed-sweep'],
    );
    expect(LIST_SWEEP_INTERVAL_MS).toBe(15_000);
    expect(LIST_JOB_OPTIONS).toMatchObject({ removeOnComplete: true, removeOnFail: true });
  });

  it('keys a screening by its inquiry, and carries ids only', async () => {
    const recording = createRecordingQueue<ListScreenJob>();
    const inquiryId = newId('inq');

    await createListScreenQueue({ queue: recording }).enqueueListScreen({
      environmentId,
      inquiryId,
    });

    expect(recording.jobs).toEqual([
      {
        name: LIST_SCREEN_JOB,
        data: { environmentId, inquiryId },
        options: expect.objectContaining({ jobId: inquiryId }) as unknown,
      },
    ]);
  });

  it('keys an import by its importer', async () => {
    const recording = createRecordingQueue<ListImportJob>();
    const importerId = newId('mprt');

    await createListImportQueue({ queue: recording }).enqueueListImport({
      environmentId,
      importerId,
    });

    expect(recording.jobs).toEqual([
      {
        name: LIST_IMPORT_JOB,
        data: { environmentId, importerId },
        options: expect.objectContaining({ jobId: importerId }) as unknown,
      },
    ]);
  });

  it('keys an embed by its item, a face or a background', async () => {
    const recording = createRecordingQueue<ListItemEmbedJob>();
    const queue = createListItemEmbedQueue({ queue: recording });
    const face = newId('lifc');
    const background = newId('lisb');

    await queue.enqueueListItemEmbed({ environmentId, itemId: face });
    await queue.enqueueListItemEmbed({ environmentId, itemId: background });

    expect(recording.jobs.map(({ name, data }) => ({ name, data }))).toEqual([
      { name: LIST_ITEM_EMBED_JOB, data: { environmentId, itemId: face } },
      { name: LIST_ITEM_EMBED_JOB, data: { environmentId, itemId: background } },
    ]);
  });

  it('refuses an id of the wrong kind, naming no value', async () => {
    const screens = createListScreenQueue({ queue: createRecordingQueue() });
    const imports = createListImportQueue({ queue: createRecordingQueue() });
    const embeds = createListItemEmbedQueue({ queue: createRecordingQueue() });

    await expect(
      screens.enqueueListScreen({ environmentId, inquiryId: newId('ver') }),
    ).rejects.toThrow('list-screen jobs need');
    await expect(
      imports.enqueueListImport({ environmentId, importerId: newId('lst') }),
    ).rejects.toThrow('list-import jobs need');
    await expect(
      embeds.enqueueListItemEmbed({ environmentId, itemId: newId('lis') }),
    ).rejects.toThrow('list-item-embed jobs need');
  });

  it('opens no queue until the first add, and one after it', async () => {
    bull.created.length = 0;
    const screens = createListScreenQueue({ connection: { url: 'redis://localhost:1' } });
    expect(bull.created).toEqual([]);

    await screens.enqueueListScreen({ environmentId, inquiryId: newId('inq') });
    await screens.close();

    expect(bull.created).toEqual([LIST_SCREEN_QUEUE]);
    await createListImportQueue({ connection: { url: 'redis://localhost:1' } }).close();
    await createListItemEmbedQueue({ connection: { url: 'redis://localhost:1' } }).close();
    expect(bull.created).toEqual([LIST_SCREEN_QUEUE]);
  });
});
