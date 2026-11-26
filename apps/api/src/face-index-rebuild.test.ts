/**
 * `pnpm --filter @openverify/api face-index:rebuild` (C42.7, `scripts/face-index-rebuild.ts`): the
 * command line and its output line, counts only. The rebuild itself is tested in
 * `jobs/face-index-rebuild.test.ts`. Vitest runs `src/**` tests, so the script's tests live here.
 */
import { SensitiveQueryError } from '@openverify/db';
import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FACE_REBUILD_BATCH_SIZE,
  FaceIndexRebuildUsageError,
  MAX_FACE_REBUILD_BATCH_SIZE,
  describeFaceIndexRebuild,
  describeFaceIndexRebuildFailure,
  parseFaceIndexRebuildArgs,
} from '../scripts/face-index-rebuild.js';
import { ConfigError } from './config.js';

describe('parseFaceIndexRebuildArgs', () => {
  it('runs for real with the default batch size by default', () => {
    expect(parseFaceIndexRebuildArgs([])).toEqual({
      dryRun: false,
      batchSize: DEFAULT_FACE_REBUILD_BATCH_SIZE,
    });
  });

  it('reads --dry-run and --batch-size in both spellings, capping the size', () => {
    expect(parseFaceIndexRebuildArgs(['--dry-run', '--batch-size=25'])).toEqual({
      dryRun: true,
      batchSize: 25,
    });
    expect(parseFaceIndexRebuildArgs(['--batch-size', '20000'])).toEqual({
      dryRun: false,
      batchSize: MAX_FACE_REBUILD_BATCH_SIZE,
    });
  });

  it.each([[['--batch-size=0']], [['--batch-size']], [['--batch-size=x']], [['--force']]])(
    'refuses %j with the usage',
    (argv) => {
      expect(() => parseFaceIndexRebuildArgs(argv)).toThrow(FaceIndexRebuildUsageError);
      expect(() => parseFaceIndexRebuildArgs(argv)).toThrow(/usage: face-index:rebuild/);
    },
  );
});

describe('describeFaceIndexRebuild', () => {
  it('prints counts only', () => {
    const report = { examined: 4, rewritten: 2, deleted: 1, failed: 1 };
    expect(describeFaceIndexRebuild(report, { dryRun: false, batchSize: 100 })).toBe(
      'face-index:rebuild: done: examined 4 templates, rewrote 2, deleted 1, left 1 after a vision failure.',
    );
    expect(describeFaceIndexRebuild(report, { dryRun: true, batchSize: 100 })).toBe(
      'face-index:rebuild: dry run: examined 4 templates, would rewrite 2, would delete 1; nothing was written.',
    );
  });
});

describe('describeFaceIndexRebuildFailure (Workflow 4B review H001)', () => {
  it('prints a failed query by its class and SQLSTATE, never its parameters', () => {
    // A synthetic layout, as rewriteSelfieBackground's parameters would hold one.
    const failure = new DrizzleQueryError(
      'update "selfie_backgrounds" set "layout" = $1',
      ['[37.123,37.123,37.123]'],
      Object.assign(new Error('deadlock detected'), { code: '40P01', severity: 'ERROR' }),
    );
    const line = describeFaceIndexRebuildFailure(failure);

    expect(line).not.toContain('37.123');
    expect(line).toBe('DrizzleQueryError: the query failed (SQLSTATE 40P01)');
    expect(
      describeFaceIndexRebuildFailure(new SensitiveQueryError('rewriteSelfieBackground', '40P01')),
    ).toBe('rewriteSelfieBackground failed (SQLSTATE 40P01)');
  });

  it('prints the usage and configuration messages whole: they name flags and variables', () => {
    const usage = new FaceIndexRebuildUsageError('Unknown argument --force. usage: …');
    const config = new ConfigError(['DATABASE_URL: is required']);

    expect(describeFaceIndexRebuildFailure(usage)).toBe(usage.message);
    expect(describeFaceIndexRebuildFailure(config)).toBe(config.message);
  });
});
