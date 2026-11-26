/**
 * C78.3, C78.8: the variant groups the held-out generator draws its group cases from. It reads the
 * same rigour `person_names.txt` the build filters (one group per line, `form, form, … => id`), and
 * keeps only the groups `isHeldOutGroup(id, seed)` selects with `evaluation-6`'s seed: the tenth the
 * `--hold-out <seed>` build drops, so the evaluated matcher cannot know them. The group id is the
 * text after ` => ` (a Wikidata QID, or rigour's `X…` for a manual group); the build must key
 * `isHeldOutGroup` by the same id.
 */
import { writingSystemsOf } from '@openverify/checks';
import { isHeldOutGroup } from '../../record/index.js';

/** One variant group: its id (a Wikidata QID, or rigour's `X…` for a manual group) and forms. */
export interface VariantGroup {
  readonly id: string;
  readonly forms: readonly string[];
}

/** Parses rigour's group lines (blank lines and lines without ` => ` are skipped). */
export function parseVariantGroups(text: string): VariantGroup[] {
  return text.split('\n').flatMap((line) => {
    const arrow = line.lastIndexOf(' => ');
    if (arrow < 0) {
      return [];
    }
    const id = line.slice(arrow + 4).trim();
    const forms = line
      .slice(0, arrow)
      .split(',')
      .map((form) => form.trim())
      .filter((form) => form !== '');
    return id === '' || forms.length === 0 ? [] : [{ id, forms }];
  });
}

/** The groups the build for `seed` holds out. */
export function heldOutGroups(groups: readonly VariantGroup[], seed: string): VariantGroup[] {
  return groups.filter((group) => isHeldOutGroup(group.id, seed));
}

/** A group's single-word forms, Latin and in other scripts the matcher handles. */
export function formsByScript(group: VariantGroup): {
  readonly latin: readonly string[];
  readonly other: readonly string[];
} {
  const latin: string[] = [];
  const other: string[] = [];
  for (const form of group.forms) {
    const systems = [...writingSystemsOf(form)];
    if (form.includes(' ') || systems.length !== 1) {
      continue;
    }
    if (systems[0] === 'latin') {
      latin.push(form);
    } else if (systems[0] !== 'other') {
      other.push(form);
    }
  }
  return { latin, other };
}
