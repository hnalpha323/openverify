/**
 * C161.5 (decisions 31 and 67; review H14; V16): the review status of each built-in locale.
 * Owned by `flow-i18n` from Workflow 9A Stage 2; its per-key digest test downgrades a `reviewed`
 * locale to `partially-reviewed` when a key changes. No built-in translation has a recorded human
 * review at the Phase 9 base (`docs/research/phase9-inventory.md` section 11), so every non-source
 * locale is `machine-drafted`: written by the build agents, which is machine translation.
 */

export const BUILT_IN_LOCALES = ['en', 'es', 'fr', 'de', 'ar'] as const;
export type BuiltInLocale = (typeof BUILT_IN_LOCALES)[number];

export type LocaleReviewStatus =
  | { readonly status: 'source' }
  | { readonly status: 'machine-drafted' }
  | {
      readonly status: 'partially-reviewed';
      readonly unreviewedKeys: readonly string[];
      /** The review this status was downgraded from, when there was one (its snapshot's digest). */
      readonly by?: string;
      readonly date?: string;
      readonly catalogSha256?: string;
      /** The per-key digests of the catalog as reviewed (`localeKeyDigests`), when there was one. */
      readonly keySha256?: Readonly<Record<string, string>>;
    }
  | {
      readonly status: 'reviewed';
      /** The fluent reviewer's name, as they gave it. */
      readonly by: string;
      /** The review's date, `YYYY-MM-DD`. */
      readonly date: string;
      /** The SHA-256 of the catalog as reviewed. */
      readonly catalogSha256: string;
      /**
       * R004 (Workflow 10A): the per-key digests of the catalog as reviewed, the snapshot a served
       * status is checked against; without it (or when it is not the catalog `catalogSha256` names)
       * every key is unreviewed (fail closed).
       */
      readonly keySha256?: Readonly<Record<string, string>>;
    };

export const LOCALE_REVIEW_STATUS: Readonly<Record<BuiltInLocale, LocaleReviewStatus>> =
  Object.freeze({
    en: Object.freeze({ status: 'source' }),
    es: Object.freeze({ status: 'machine-drafted' }),
    fr: Object.freeze({ status: 'machine-drafted' }),
    de: Object.freeze({ status: 'machine-drafted' }),
    ar: Object.freeze({ status: 'machine-drafted' }),
  });

/** A catalog as nested messages, the shape of the flow's `Messages` and its exported JSON. */
export interface MessageTree {
  readonly [key: string]: string | MessageTree;
}

/** A SHA-256 of UTF-8 text as 64 lower-case hex digits, injected so this module stays browser-safe. */
export type Sha256Hex = (text: string) => string;

/** Every message of `tree` by its dotted key (`consent.title`), sorted by key. */
export function flattenMessages(tree: MessageTree): (readonly [key: string, text: string])[] {
  const walk = (node: MessageTree, prefix: string): (readonly [string, string])[] =>
    Object.entries(node).flatMap(([key, value]) =>
      typeof value === 'string'
        ? [[`${prefix}${key}`, value] as const]
        : walk(value, `${prefix}${key}.`),
    );
  return walk(tree, '').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * C161.5: the SHA-256 of each message, NFC-normalised, by dotted key. A reviewer signs a catalog
 * through these digests, so a later change to any one message is found by key.
 */
export function localeKeyDigests(
  tree: MessageTree,
  sha256: Sha256Hex,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    flattenMessages(tree).map(([key, text]) => [key, sha256(text.normalize('NFC'))]),
  );
}

/**
 * The `catalog-sha256` of a review record: the SHA-256 of the sorted lines `<key>\t<digest>\n`
 * of the per-key digests, so it names exactly the messages reviewed, whatever their order.
 */
export function catalogSha256(
  digests: Readonly<Record<string, string>>,
  sha256: Sha256Hex,
): string {
  const lines = Object.keys(digests)
    .sort()
    .map((key) => `${key}\t${digests[key] ?? ''}\n`);
  return sha256(lines.join(''));
}

/**
 * C161.5: the status a locale really has, given the per-key digests of its catalog now
 * (`current`) and of the catalog as reviewed (`reviewed`, the snapshot whose digest the record
 * names; `null` when it cannot be read). A `reviewed` locale with a key added or changed since its
 * review is `partially-reviewed`, listing those keys; a `partially-reviewed` one keeps its keys
 * that still exist and adds those changed since. Fail closed: without the snapshot every key is
 * unreviewed. A removed key changes nothing, and `source` and `machine-drafted` stay as declared.
 */
export function effectiveReviewStatus(
  declared: LocaleReviewStatus,
  digests: {
    readonly current: Readonly<Record<string, string>>;
    readonly reviewed: Readonly<Record<string, string>> | null;
  },
): LocaleReviewStatus {
  if (declared.status === 'source' || declared.status === 'machine-drafted') {
    return declared;
  }
  const { current, reviewed } = digests;
  const changed = Object.keys(current).filter(
    (key) => reviewed === null || !Object.hasOwn(reviewed, key) || reviewed[key] !== current[key],
  );
  const kept =
    declared.status === 'partially-reviewed'
      ? declared.unreviewedKeys.filter((key) => Object.hasOwn(current, key))
      : [];
  const unreviewedKeys = [...new Set([...kept, ...changed])].sort();
  if (declared.status === 'reviewed' && unreviewedKeys.length === 0) {
    return declared;
  }
  const base = {
    ...(declared.by === undefined ? {} : { by: declared.by }),
    ...(declared.date === undefined ? {} : { date: declared.date }),
    ...(declared.catalogSha256 === undefined ? {} : { catalogSha256: declared.catalogSha256 }),
    ...(declared.keySha256 === undefined ? {} : { keySha256: declared.keySha256 }),
  };
  if (
    declared.status === 'partially-reviewed' &&
    unreviewedKeys.join('\n') === [...declared.unreviewedKeys].sort().join('\n')
  ) {
    return declared;
  }
  return { status: 'partially-reviewed', unreviewedKeys, ...base };
}

/**
 * R004 (Workflow 10A): the status a built-in locale is served with, everywhere it is read: the
 * declared status of `locale`, held by {@link effectiveReviewStatus} to `catalog`, the locale's
 * catalog now, against the snapshot its record carries.
 */
export function servedReviewStatus(
  locale: BuiltInLocale,
  catalog: MessageTree,
  sha256: Sha256Hex,
  declared: Readonly<Record<BuiltInLocale, LocaleReviewStatus>> = LOCALE_REVIEW_STATUS,
): LocaleReviewStatus {
  const record = declared[locale];
  if (record.status === 'source' || record.status === 'machine-drafted') {
    return record;
  }
  // The snapshot counts only as the catalog its record names; anything else is no snapshot.
  const snapshot =
    record.keySha256 !== undefined &&
    record.catalogSha256 !== undefined &&
    catalogSha256(record.keySha256, sha256) === record.catalogSha256
      ? record.keySha256
      : null;
  return effectiveReviewStatus(record, {
    current: localeKeyDigests(catalog, sha256),
    reviewed: snapshot,
  });
}
