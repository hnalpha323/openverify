/**
 * The generated-document rule (the plan's "Generated documents" pattern): a committed page must
 * equal a fresh render, byte for byte. Tests call {@link staleFiles} with a render held in memory;
 * nothing here writes.
 */
import type { GeneratedFile, Repository } from './types.js';

/** A rendered file whose committed copy is missing or differs. */
export interface StaleFile {
  readonly path: string;
  readonly reason: 'missing' | 'differs';
}

/** The rendered files whose committed copy is missing or differs, in the render's order. */
export function staleFiles(
  repo: Repository,
  files: readonly GeneratedFile[],
): readonly StaleFile[] {
  return files.flatMap((file): StaleFile[] => {
    if (!repo.exists(file.path)) {
      return [{ path: file.path, reason: 'missing' }];
    }
    return repo.readText(file.path) === file.content
      ? []
      : [{ path: file.path, reason: 'differs' }];
  });
}
