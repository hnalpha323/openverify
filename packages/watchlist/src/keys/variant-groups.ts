/**
 * C78.3: cross-script and spelling variant groups. The source is rigour `person_names.txt` @
 * `b0ba4ad` (MIT repository; Wikidata CC0 groups), fetched by `scripts/fetch_data.py` into the
 * gitignored `data/`. `scripts/build-variant-groups.mjs` filters it at build time into
 * `data/variant-groups.json`, the file the worker loads and its image carries; neither is
 * committed. The filter drops groups above 60 forms (`variant-group-max-forms`), forms in a script
 * the matcher does not handle (C58's `other`, or two scripts in one form) and groups left with
 * fewer than two forms; `--hold-out <seed>` also drops the groups `isHeldOutGroup(id, seed)`
 * selects, for `evaluation-6`'s build only (C78.8, V12). Forms are stored as the matcher reads
 * tokens: a Latin form in both C58 renderings, any other in its original-script form, a form of
 * several words joined (so a joined token pair meets it).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SCREENING_CONSTANTS } from '@openverify/core';
import { z } from 'zod';
import { LEGAL_FORMS_FILE, nameToken, splitNameText } from '../names/index.js';
import { isHeldOutGroup } from '../record/index.js';

/** The filtered file's format tag. */
export const VARIANT_GROUPS_FORMAT = 'openverify/variant-groups/v1';

/** The filtered file's name, in the repository's (or the image's) `data/` folder. */
export const VARIANT_GROUPS_FILE_NAME = 'variant-groups.json';

/**
 * The SHA-256 of the shipped build (no hold-out) of the pinned rigour file by this filter. A
 * loaded file with another digest is not the matcher's data (C78.3, F14): runs that need it error
 * `matcher_data_unavailable` and syncs are refused (`refused_matcher_data`). The build script
 * refuses to write a shipped build with another digest, so a filter change updates it here.
 */
export const SHIPPED_VARIANT_GROUPS_SHA256 =
  '29d0583854563f81084c05d78b5ea8805ca14630cbf655349cfa09fca84c3bfb';

/** The most forms a kept group may have (`variant-group-max-forms`, C78.3). */
const MAX_FORMS = SCREENING_CONSTANTS['variant-group-max-forms'].value;

/** One group: its id (a Wikidata item or rigour's `X` override) and its forms. */
export type VariantGroup = readonly [id: string, forms: readonly string[]];

/** The groups the matcher reads: which groups each normalised form belongs to. */
export interface VariantGroups {
  /** The SHA-256 of the file they were read from (`keysVersion` joins it). */
  readonly sha256: string;
  readonly groupCount: number;
  readonly formCount: number;
  /** The ids of the groups a form belongs to, sorted; empty for none. */
  groupsOf(form: string): readonly string[];
}

const NONE: readonly string[] = Object.freeze([]);

/** Indexes groups of already normalised forms. */
function indexed(groups: readonly VariantGroup[], sha256: string): VariantGroups {
  const byForm = new Map<string, string[]>();
  for (const [id, forms] of groups) {
    for (const form of forms) {
      const ids = byForm.get(form) ?? [];
      if (!ids.includes(id)) {
        ids.push(id);
      }
      byForm.set(form, ids);
    }
  }
  for (const ids of byForm.values()) {
    ids.sort();
  }
  return {
    sha256,
    groupCount: groups.length,
    formCount: byForm.size,
    groupsOf: (form) => byForm.get(form) ?? NONE,
  };
}

/** The forms a group stores for one written form (see the module comment); empty to drop it. */
export function variantFormsOf(form: string): string[] {
  const tokens = splitNameText(form).map((raw) => nameToken(raw));
  const script = tokens[0]?.script ?? null;
  if (
    script === null ||
    script === 'other' ||
    script === 'mixed' ||
    tokens.some((token) => token.script !== script)
  ) {
    return [];
  }
  const joined =
    script === 'latin'
      ? [
          tokens.map((token) => token.simple).join(''),
          tokens.map((token) => token.expanded).join(''),
        ]
      : [tokens.map((token) => token.original ?? '').join('')];
  return [...new Set(joined)].filter((value) => value !== '');
}

/** Groups held in memory (tests, the evaluation build), with a digest of their own. */
export function variantGroupsFrom(groups: readonly VariantGroup[], sha256: string): VariantGroups {
  return indexed(
    groups.map(([id, forms]) => [id, [...new Set(forms.flatMap(variantFormsOf))]] as const),
    sha256,
  );
}

const fileSchema = z.object({
  format: z.literal(VARIANT_GROUPS_FORMAT, { error: 'not a variant-group file (format)' }),
  source: z.object({ name: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/u) }),
  heldOut: z.boolean(),
  maxForms: z.int(),
  groups: z.array(z.tuple([z.string().min(1), z.array(z.string().min(1)).min(2)])),
});

const sha256Of = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

/**
 * Reads the filtered file, computing its SHA-256 over the bytes.
 * @throws {Error} for a file that is not in the filtered format.
 */
export function parseVariantGroups(bytes: Uint8Array): VariantGroups {
  const file = fileSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
  return indexed(file.groups, sha256Of(bytes));
}

/** What loading the filtered file found (the caller decides; nothing is logged here). */
export type VariantGroupsLoad =
  | { readonly status: 'loaded'; readonly groups: VariantGroups }
  | { readonly status: 'missing' }
  | { readonly status: 'unexpected'; readonly sha256: string };

/**
 * Loads the filtered file at `path`: `missing` when it is absent or unreadable, `unexpected` when
 * its digest is not {@link SHIPPED_VARIANT_GROUPS_SHA256} (or `expectedSha256`), else `loaded`.
 */
export function loadVariantGroups(
  path: string,
  expectedSha256: string = SHIPPED_VARIANT_GROUPS_SHA256,
): VariantGroupsLoad {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    return { status: 'missing' };
  }
  const sha256 = sha256Of(bytes);
  if (sha256 !== expectedSha256) {
    return { status: 'unexpected', sha256 };
  }
  try {
    return { status: 'loaded', groups: parseVariantGroups(bytes) };
  } catch {
    return { status: 'unexpected', sha256 };
  }
}

/** One line of `person_names.txt`: `form, form, ... => id`. */
export function parseRigourPersonNames(text: string): VariantGroup[] {
  const groups: VariantGroup[] = [];
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') {
      return;
    }
    const arrow = line.lastIndexOf(' => ');
    const id = arrow === -1 ? '' : line.slice(arrow + 4).trim();
    const forms = line
      .slice(0, Math.max(arrow, 0))
      .split(',')
      .map((form) => form.trim())
      .filter((form) => form !== '');
    if (id === '' || forms.length === 0) {
      throw new Error(`person_names.txt line ${String(index + 1)}: expected "forms => id"`);
    }
    groups.push([id, forms]);
  });
  return groups;
}

export interface VariantGroupFilterOptions {
  /** `evaluation-6`'s seed: also drop the groups {@link isHeldOutGroup} selects. */
  readonly holdOutSeed?: string | null | undefined;
}

/** What the filter kept and dropped, by count (no form is reported). */
export interface VariantGroupFilterReport {
  readonly inputGroups: number;
  readonly keptGroups: number;
  readonly keptForms: number;
  readonly droppedOversize: number;
  readonly droppedHeldOut: number;
  readonly droppedTooFewForms: number;
  readonly droppedForms: number;
}

/** The C78.3 build filter, groups sorted by id. */
export function filterVariantGroups(
  groups: readonly VariantGroup[],
  options: VariantGroupFilterOptions = {},
): { readonly groups: VariantGroup[]; readonly report: VariantGroupFilterReport } {
  const kept: VariantGroup[] = [];
  let droppedOversize = 0;
  let droppedHeldOut = 0;
  let droppedTooFewForms = 0;
  let droppedForms = 0;
  let keptForms = 0;
  const seed = options.holdOutSeed ?? null;
  for (const [id, forms] of groups) {
    if (forms.length > MAX_FORMS) {
      droppedOversize += 1;
      continue;
    }
    if (seed !== null && isHeldOutGroup(id, seed)) {
      droppedHeldOut += 1;
      continue;
    }
    const normalised = new Set<string>();
    for (const form of forms) {
      const stored = variantFormsOf(form);
      if (stored.length === 0) {
        droppedForms += 1;
      }
      stored.forEach((value) => normalised.add(value));
    }
    if (normalised.size < 2) {
      droppedTooFewForms += 1;
      continue;
    }
    keptForms += normalised.size;
    kept.push([id, [...normalised]]);
  }
  kept.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return {
    groups: kept,
    report: {
      inputGroups: groups.length,
      keptGroups: kept.length,
      keptForms,
      droppedOversize,
      droppedHeldOut,
      droppedTooFewForms,
      droppedForms,
    },
  };
}

/** The filtered file: one JSON document, a group per line, ending with a newline. */
/**
 * Owner decision 19 after 6B: the MIT notice of rigour, whose `person_names.txt` the file is built
 * from; MIT asks for its notice to travel with the data. The text is the one the committed
 * legal-form table carries (`data/legal-forms.json`, from rigour's `LICENSE` at `607fa82`), pinned
 * by its SHA-256: rigour's `LICENSE` at `b0ba4ad`, the commit `person_names.txt` is pinned to, has
 * the same digest (checked 2026-10-28).
 */
export const RIGOUR_LICENSE = Object.freeze({
  license: 'MIT',
  copyright: 'Copyright (c) 2023-2025: OpenSanctions Datenbanken GmbH',
  sha256: '099eeaff53a618bbd4420fa4746311ff72e418816bb21133781af0493d63c6d1',
});

/**
 * rigour's MIT licence text, read from the committed legal-form table.
 * @throws {Error} when the text is not the pinned one.
 */
export function rigourLicenseText(): string {
  const table = JSON.parse(readFileSync(LEGAL_FORMS_FILE, 'utf8')) as {
    source?: { licenseText?: unknown };
  };
  const text = table.source?.licenseText;
  if (typeof text !== 'string' || sha256Of(text) !== RIGOUR_LICENSE.sha256) {
    throw new Error('the rigour licence text is not the pinned one (data/legal-forms.json)');
  }
  return text;
}

/** The licence members the file carries (owner decision 19 after 6B). */
export interface VariantGroupsLicense {
  readonly license: string;
  readonly copyright: string;
  readonly licenseText: string;
}

export function serialiseVariantGroups(
  groups: readonly VariantGroup[],
  meta: {
    readonly sourceSha256: string;
    readonly heldOut: boolean;
    readonly license?: VariantGroupsLicense | undefined;
  },
): string {
  const head = JSON.stringify({
    format: VARIANT_GROUPS_FORMAT,
    source: { name: 'rigour_person_names', sha256: meta.sourceSha256 },
    heldOut: meta.heldOut,
    maxForms: MAX_FORMS,
    ...(meta.license === undefined
      ? {}
      : {
          license: meta.license.license,
          copyright: meta.license.copyright,
          licenseText: meta.license.licenseText,
        }),
  });
  const lines = groups.map((group) => JSON.stringify(group));
  return `${head.slice(0, -1)},"groups":[\n${lines.join(',\n')}\n]}\n`;
}
