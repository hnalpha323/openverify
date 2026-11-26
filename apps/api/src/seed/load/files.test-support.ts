/**
 * The seed record's and the watchlist step's file operations over node:fs (C268.3): what
 * `scripts/seed-load.ts`, a development tool never compiled into an image, and the seed:load tests
 * give `runLoadSeed`. The record file is created exclusively (no symlink followed) at its mode and
 * synced before it is renamed into place.
 */
import { constants } from 'node:fs';
import { lstat, mkdtemp, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LoadSeedFiles } from './record.js';

export const nodeFiles: LoadSeedFiles = {
  lstat: (path) => lstat(path),
  realpath: (path) => realpath(path),
  readFile: (path, encoding) => readFile(path, encoding),
  async createExclusive(path, text, mode) {
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
    const handle = await open(path, flags, mode);
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  rename: (from, to) => rename(from, to),
  makeTemporaryDirectory: (prefix) => mkdtemp(join(tmpdir(), prefix)),
  async writeChunks(path, chunks, mode) {
    const handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      mode,
    );
    try {
      for (const chunk of chunks) {
        await handle.write(chunk);
      }
    } finally {
      await handle.close();
    }
  },
  removeDirectory: (path) => rm(path, { recursive: true, force: true }),
};
