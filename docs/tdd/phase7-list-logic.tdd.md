# TDD evidence: Workflow 7B Stage 2, `list-logic` (Phase 7)

- **Slice owner:** the Workflow 7B Stage 2 `list-logic` agent, beside `foundation-7b` and `transaction-schemas`.
- **Date:** 2026-10-31.
- **Base:** `1396ad20` (Stage 1a's last commit).
- **Input:** the `list-logic` bullet of `docs/plans/phase-7.plan.md`, C98.2, C100.3 to C100.6, C101.2, and Stage 1a amendments 3, 4, 10, 11 and 14.
- **Owned paths:** `packages/checks/src/{lists,csv}/`, `packages/watchlist/src/list-keys/`.

All commands ran after `source scripts/env.sh`. Output is trimmed to the lines that matter. Every value is synthetic: addresses from the documentation ranges, emails at example.com, .org and .example, phone numbers from the fictional ranges, fictional or common names.

## 1. The stubs (`e8f7a030`, `ac41e3e0`)

Stage 1a froze the names but typed `graphKeyInput` and the two graph name functions as `ListKeyInput`, whose `keyKind` holds only the fourteen list labels, so `identifier-reference-id` and the four other graph-only labels had no type. `GraphKeyInput` and `GraphKeyKind` (the registry's `GraphKeySource` without `existing-index`) came first, with the `member` of a refusal and the import names, then `LIST_VALUE_LIMITS`, so that the RED commit compiled and type-checked.

## 2. The kinds in `packages/checks`, the CSV writer, the import tables (RED `3641b022`, GREEN `383fcce8`, refactor `469737fc`)

RED: five test files, compiling, type-checking and linting, failing on the stubs. The 10 that passed read constants: the version text, the caps against the contract source, the column-name form.

```
$ pnpm --filter @openverify/checks typecheck
$ tsc --noEmit                                                                 (rc 0)
$ (cd packages/checks && pnpm exec eslint src/lists src/csv)                   lint=0
$ (cd packages/checks && pnpm exec vitest run src/lists/ src/csv/ --coverage.enabled=false)
 FAIL  src/lists/list-keys.test.ts > a refusal echoes no value (C100.4) > carries a code, in its message too
AssertionError: expected ListLogicNotBuiltError to be an instance of ListKeyInputError
 Test Files  5 failed (5)
      Tests  307 failed | 10 passed (317)
```

GREEN took three passes, each failure read first:

```
# first pass
 FAIL  src/lists/graph-keys.test.ts > the address key (C101.2) > refuses a line with no letter or digit, and a country it does not know
 FAIL  src/lists/list-keys-golden.test.ts > ... holds its golden digest      (the RED placeholder, as intended)
 FAIL  src/lists/list-keys.test.ts > geolocation (C98.2) > reads {"latitude":-33.8688197,"longitude":151.2092955,...}
      Tests  3 failed | 328 passed (331)
  normalise.ts 295:54  error  ... quadratic runtime  regexp/no-super-linear-move
```

- A second line (`Apt 4B`) hid an empty first street line: the first line is now checked alone.
- `151.2092955` sits on a rounding boundary in binary, so the vector moved to `151.2092956`. The rule is `toFixed(6)`, and the digest still holds the boundary value.
- The trailing-zero regex became a loop.
- A phone with too few digits parses (`+1202`), so `isPossible()` joined the rule, with a vector.

The digest was pinned only after reading the outputs it covers (a script over the golden inputs):

```
US|CA|94105|springfield|12 north main street
DE|BY|80331|munchen|rosenstrasse 4 3
GB|ENG|NW16XE|london|221b baker street 2
ßtraße   i̇stanbul   σας
+493012345678
a@b@xn--bcher-kva.example   xn--bcher-kva.example   example
```

```
$ (cd packages/checks && pnpm exec vitest run src/lists/ src/csv/ src/index.test.ts --coverage...)
 Test Files  6 passed (6)
      Tests  332 passed (332)
  address-key.ts 100/89.58/100/100, import-tables.ts 100/94.11/100/100, normalise.ts 100/99.04/100/100
rc=0
```

The address key needed a choice of its own. The C58.4 dictionaries are relations (`ave` is `avenida` or `avenue`), and `matchAddresses` compares by intersection, which has no canonical form. The transitive closure of the relation was measured and refused: its largest street-type class holds 48 phrases, and `n` joins `nw` and `no` in a directional class of 101, so `N Main St` would key as `NW Main St`. Of 23 common pairs (`St` and `Street`, `N` and `North`, ...), the first sorted canonical reads 14 alike, the last 15, and the canonical with the most spellings 19, and it never joins two classes. So a pair it misses (`Ct` and `Court`, `Pl` and `Place`, `W` and `West`) is no link, never a false one.

## 3. The name kinds in `packages/watchlist` (RED `59403c6f`, RED `20017a81`, GREEN `59888e2d`)

```
$ (cd packages/watchlist && pnpm exec vitest run src/list-keys --coverage.enabled=false)
 Test Files  1 failed | 1 passed (2)
      Tests  32 failed | 6 passed (38)
```

A defect found before the first GREEN was committed: reading the sample output, the Han name `小明 王` keyed as `wang|xiaoming`, so `王` and `汪` would meet on an exact, R-tier key through a lossy `any-ascii` form. ADR 0005 says a lossy comparison is not exact, so that took a RED of its own:

```
 FAIL  ... listNameKeyInputs (C98.2) > never meets on a lossy Latin form: two Han names that read alike are two people (ADR 0005)
 FAIL  ... keys an Arabic name on its normalised original, which has vowels a Latin form lost
 FAIL  ... listLastNameKeyInputs (C98.2, F17) > keys a lossy last name on its original form, as the exact keys do
      Tests  4 failed | 37 passed (41)
```

A `native` or `icao` Latin form crosses scripts, so `Мария Иванова` meets `Mariia Ivanova`; anything else keys on its normalised original. GREEN:

```
$ (cd packages/watchlist && pnpm exec vitest run src/list-keys src/stubs.test.ts --coverage...)
 index.ts | 100 | 93.75 | 100 | 100 | 48
rc=0
```

## 4. The seal-plus-HMAC cost (C98.3)

The research's script was not committed. This one is not either: no path `list-logic` owns may import `@openverify/db`, so it ran from the session scratchpad and its text is kept here. Under `/tmp/openverify-e2e.lock`, one step per hold, on one thread, Node 22.22.1:

```
$ flock /tmp/openverify-e2e.lock sh -c "cat /proc/loadavg; node ... seal-hmac-measure.ts 100000; echo rc=$?; cat /proc/loadavg"
2.89 3.49 3.66 3/998 499371
email: 100000 rows x 5: median 40.84 us/row (normalise 1.64, hmac 7.91, seal 32.84); fastest 38.87, slowest 46.14; 281 B/row stored (sealed value + hex keys), 1.00 keys/row
phone: 100000 rows x 5: median 48.18 us/row (normalise 11.98, hmac 6.82, seal 29.37); fastest 45.84, slowest 61.37; 235 B/row stored (sealed value + hex keys), 1.00 keys/row
name: 100000 rows x 5: median 55.12 us/row (normalise 10.06, hmac 13.63, seal 29.67); fastest 51.58, slowest 55.51; 327 B/row stored (sealed value + hex keys), 2.00 keys/row
rc=0
3.00 3.44 3.63 1/931 501272
```

The research's 35 µs and 191 B were close on time and low on size. 191 B counted a raw 32-byte key, and C98.1 stores 64 hex characters; a sealed value here also carries its JSON member names. At load 3, a 100,000-row import spends about 4 to 5.5 s here, before its inserts. The HMAC is the small part; sealing is 54 to 80% of the cost.

```ts
/**
 * The seal-plus-HMAC cost of one list item (C98.3): the C98.2 normaliser, identifierKey per key, and
 * sealJson of the item as entered, on one thread, over synthetic values.
 * Run from packages/watchlist:
 * node --experimental-transform-types --no-warnings --conditions=@openverify/source \
 *   --import ../checks/scripts/register-ts.mjs <this file> [rows]
 */
import { randomBytes } from 'node:crypto';
import { listKeyInputs } from '<repo>/packages/checks/src/index.ts';
import { identifierKey, keyringFromEnv, sealJson } from '<repo>/packages/db/src/index.ts';
import { listNameKeyInputs } from '<repo>/packages/watchlist/src/index.ts';
import { seededRandom, fictionalPersonName } from '<repo>/packages/watchlist/src/testing/index.ts';

const ROWS = Number(process.argv[2] ?? 100_000);
const ROUNDS = 5;
const environmentId = 'env_0123456789abcdefghijklmnop';
const blindKey = new Uint8Array(randomBytes(32));
const keyring = keyringFromEnv({ OPENVERIFY_KEK: randomBytes(32).toString('base64') });

type Row = { item: Record<string, unknown>; keys: () => { keyKind: string; input: string }[] };

function emailRows(): Row[] {
  return Array.from({ length: ROWS }, (_, n) => {
    const item = { value: `user.${n.toString(36)}@example.org`, 'match-type': 'email_address' };
    return { item, keys: () => listKeyInputs('email-address', item) };
  });
}
function phoneRows(): Row[] {
  return Array.from({ length: ROWS }, (_, n) => {
    const item = { value: `+1 202 555 01${String(n % 100).padStart(2, '0')}` };
    return { item, keys: () => listKeyInputs('phone-number', item) };
  });
}
function nameRows(): Row[] {
  const random = seededRandom('list-logic-seal-hmac');
  return Array.from({ length: ROWS }, () => {
    const person = fictionalPersonName(random);
    const item = { 'name-first': person.given.latin, 'name-last': person.family.latin };
    return { item, keys: () => listNameKeyInputs(item) };
  });
}

const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)] ?? 0;

function measure(name: string, rows: Row[]) {
  const total: number[] = [];
  const normalise: number[] = [];
  const hmac: number[] = [];
  const seal: number[] = [];
  let bytes = 0;
  let keysPerRow = 0;
  for (let round = 0; round < ROUNDS; round += 1) {
    const inputs = [] as { keyKind: string; input: string }[][];
    const t0 = process.hrtime.bigint();
    for (const row of rows) inputs.push(row.keys());
    const t1 = process.hrtime.bigint();
    let keyCount = 0;
    let keyBytes = 0;
    for (const keys of inputs) {
      for (const { keyKind, input } of keys) {
        keyBytes += identifierKey(blindKey, { environmentId, kind: keyKind as 'identifier-email', input }).length;
        keyCount += 1;
      }
    }
    const t2 = process.hrtime.bigint();
    let sealedBytes = 0;
    rows.forEach((row, index) => {
      sealedBytes += sealJson('list_items.value', `liea_${String(index).padStart(26, '0')}`, row.item, keyring).length;
    });
    const t3 = process.hrtime.bigint();
    normalise.push(Number(t1 - t0) / 1e3 / ROWS);
    hmac.push(Number(t2 - t1) / 1e3 / ROWS);
    seal.push(Number(t3 - t2) / 1e3 / ROWS);
    total.push(Number(t3 - t0) / 1e3 / ROWS);
    bytes = (sealedBytes + keyBytes) / ROWS;
    keysPerRow = keyCount / ROWS;
  }
  const us = (values: number[]) => percentile(values, 0.5).toFixed(2);
  console.log(`${name}: ${ROWS} rows x ${ROUNDS}: median ${us(total)} us/row (normalise ${us(normalise)}, hmac ${us(hmac)}, seal ${us(seal)}); fastest ${percentile(total, 0).toFixed(2)}, slowest ${percentile(total, 1).toFixed(2)}; ${bytes.toFixed(0)} B/row stored (sealed value + hex keys), ${keysPerRow.toFixed(2)} keys/row`);
}

console.log(`node ${process.version}`);
measure('email', emailRows());
measure('phone', phoneRows());
measure('name', nameRows());
```

## Report (list-logic)

### Handoff

**How to run.** `source scripts/env.sh` first.

- Checks: `pnpm --filter @openverify/checks exec vitest run src/lists src/csv --coverage.enabled=false` (321 tests).
- Watchlist: `pnpm --filter @openverify/watchlist exec vitest run src/list-keys --coverage.enabled=false` (41 tests).

**`LIST_KEYS_VERSION`** (`@openverify/checks`) is the text `lists-1`, written to `normaliser_version`; a stored row differing from it answers `normaliser_outdated`. It must change whenever any output changes: a rule of this folder, `normalizeIdentificationNumber`, `@openverify/signals/address`, a `libphonenumber-js` metadata bump that moves a national number, the C58.4 dictionaries or folds, or the C78 analysis (`KEYS_VERSION`). Two digests guard it, one per version, each added and never edited: `packages/checks/src/lists/list-keys-golden.test.ts` and `packages/watchlist/src/list-keys/list-name-keys.test.ts` (`lists-1;names-2`). Nothing has shipped, so a change before the first release may re-pin `lists-1`; after it, bump.

**`@openverify/checks`, lists:**

- `listKeyInputs(kind: KeyedListKind, item: ListValue, options?: ListKeyOptions): ListKeyInput[]`. The first key is `list_items.match_key`; the rest go to `list_item_keys`. Every kind here gives one key.
- `listProbeKeyInputs(kind: KeyedListKind, probe: ListValue, options?: ListKeyOptions): ListKeyInput[]`. A phone's national form needs the list's region, so key a probe per list.
- `graphKeyInput(kind: GraphKind, value: ListValue): GraphKeyInput`, which throws `TypeError` for `government_id_number`, `chip_signature`, `crypto_address`, `name_birthdate` and `name`.
- `importColumns(kind: ListKind): readonly string[]`, which throws `TypeError` for a kind with no importer.
- `importHeaderProblems(kind: ListKind, header: readonly string[]): ImportHeaderProblem[]`, with `ImportHeaderProblem { column: string | null; code }`. `column` is null for `unknown_column`, so a file with no header never echoes a person.
- `importRowItem(kind: ListKind, row: Readonly<Record<string, string>>): ListValue`, which strips the neutraliser once, leaves an empty optional cell out, and reads numbers.
- `importColumnOf(kind: ListKind, member: string): string | null`, which turns `ListKeyInputError.member` into the error's `column`.
- `importErrorCodeOfParser(parserCode: string): ImportErrorCode`, for csv-parse 7.0.3's codes: `CSV_RECORD_INCONSISTENT_FIELDS_LENGTH` and `CSV_RECORD_INCONSISTENT_COLUMNS` give `field_count_mismatch`, `CSV_MAX_RECORD_SIZE` gives `record_too_large`, anything else `invalid_value`.
- `importErrorScope(code: ImportErrorCode): 'file' | 'row'`. `invalid_encoding`, the three column codes and `row_limit_exceeded` refuse the file.
- `class ListKeyInputError(code: ImportErrorCode, member?: string)`. Its message is the code, never a value.
- Types: `ListKeyInput { keyKind: ListKeyKind; input }`, `GraphKeyInput { keyKind: GraphKeyKind; input }`, `GraphKeyKind` (`Exclude<GraphKeySource, 'existing-index'>`), `KeyedListKind`, `ListValue`, `ListKeyOptions { 'case-sensitive'?; 'default-region'?; 'field-key'? }`.
- Constants: `LIST_KEYS_VERSION`, `LIST_VALUE_LIMITS` (`email` 254, `idNumber` 100, `ip` 64, `name` 300, `phone` 32, `fieldValue` 1024, `string` 255, held to the contract's source by a test), `LISTS_AREA`.

**`@openverify/watchlist`:**

- `listNameKeyInputs(name: ListName): ListKeyInput[]`: `<last>|<first>` and `<first>|<last>` per fold, at most 4, under `identifier-name`.
- `listLastNameKeyInputs(name: ListName): ListKeyInput[]`: the last name per fold under `identifier-name-last`, without a suffix.
- `graphNameKeyInputs(name: ListName): GraphKeyInput[]`: the same keys as the list.
- `graphNameBirthdateKeyInputs(name: ListName, birthdate: string): GraphKeyInput[]`: each form plus `|YYYY-MM-DD`, under `identifier-name-birthdate`.
- `ListName { 'name-first'; 'name-last' }`, `WATCHLIST_LIST_KEYS_AREA`.

**Key kinds and inputs:**

| Kind | Key kind | Input |
|---|---|---|
| string | `identifier-string` | NFKC, trim, collapsed whitespace; `toLowerCase()` unless `case-sensitive` |
| email, `email_address` (default) | `identifier-email` | `local@domain`, local lower-cased, domain through `domainToASCII`, a root dot dropped |
| email, `domain` | `identifier-email-domain` | the domain; a leading `@` allowed; a whole address refused |
| email probe | both | the address, then the domain and every parent, the last label included |
| phone | `identifier-phone` | E.164 (`/max` metadata, `isPossible()`) |
| government ID | `identifier-government-id-number` | `<class or *>\|<n>`. Probe: `<class>\|<n>` and `*\|<n>`; a probe with no class sends `*` and every class |
| name | `identifier-name` | `<last>\|<first>`, `<first>\|<last>` per fold. A `native` or `icao` token in its fold; a lossy token in its original script; a suffix stays in the last name |
| last-name candidates | `identifier-name-last` | the last name per fold, no suffix |
| IP, single (also /32, /128) | `identifier-ip` | canonical text, IPv4-mapped folded |
| IP range | `identifier-ip-range` | `<first address>/<prefix>`, which is also the text of the `cidr` row |
| country | `identifier-country` | two upper-case letters |
| geolocation | `identifier-geolocation` | `lat,lon,radius` at 10⁻⁶°, the meridian ±180 as -180, a rounded zero unsigned. A probe sends no key: `[]` means "use the box", never "no match" |
| fingerprints | `identifier-browser-fingerprint`, `identifier-device-fingerprint` | the 64-hex HMAC, lower-cased |
| field | `identifier-field` | `<field key>\|<value>`, by the value's form: a number and a canonical decimal text meet (`42.50`, `42.5`), a boolean and its word meet, anything else by the string rule; `007` stays text |
| graph `email_address`, `phone_number` and the `_unconfirmed` two, `ip_address`, the three device kinds, `email_domain` | the shared labels | the list's input. `{ value }`, a phone's optional `default-region`. `email_domain` takes an address or a domain and refuses a free-mail domain |
| graph `reference_id` | `identifier-reference-id` | exactly as held; blank refused |
| graph `birthdate` | `identifier-birthdate` | `YYYY-MM-DD`, a real day |
| graph `postal_code` | `identifier-postal-code` | `canonicalPostalCode`, no country |
| graph `address` | `identifier-address` | `<country>\|<subdivision>\|<postal>\|<city>\|<street>` from `address-street-1`, `address-street-2` (optional), `address-city`, `address-subdivision`, `address-postal-code`, `address-country-code`; the other five are required |

**CSV writer (`@openverify/checks`):**

- `writeCsv(header: readonly string[], rows: readonly (readonly (string | number | boolean | null)[])[]): string`: every cell quoted, embedded quotes doubled, CRLF after each record, `null` as `""`. A row that does not fit the header throws `TypeError`. String cells, the header's too, are neutralised; numbers and booleans are written as they are.
- `neutraliseCell(value: string): string`: prefixes `'` before `=`, `+`, `-`, `@`, tab, CR, LF and `＝＋－＠`, also past existing apostrophes.
- `stripNeutraliser(value: string): string`: strips one, so `stripNeutraliser(neutraliseCell(v)) === v` for every value.
- `CSV_AREA`.

**How the Stage 3 agents call this:**

- `api-importers`: `importHeaderProblems`, then per row `importRowItem`, then `listKeyInputs` (or `listNameKeyInputs` for names); `ListKeyInputError.code` and `importColumnOf(kind, error.member)` give the error row.
- `api-lists`: store `LIST_KEYS_VERSION`; a fuzzy list also stores `listLastNameKeyInputs`. A `ListKeyInputError` on a probe is a value that could not be read, `probe_unavailable`, never "no match".
- `api-graph`: a `ListKeyInputError` means no row for that value.

### contractDeviations

1. `graphKeyInput`, `graphNameKeyInputs` and `graphNameBirthdateKeyInputs` return `GraphKeyInput`, not Stage 1a's `ListKeyInput`: `ListKeyKind` cannot hold the five graph-only labels. `GraphKeyKind` is `Exclude<GraphKeySource, 'existing-index'>`, and every member is a kind of `IDENTIFIER_KEY_LABELS`.
2. `ListKeyInputError` gains an optional second argument, `member`, so an importer error can name its column. The message stays the code.
3. Ours beyond the frozen names: `LIST_VALUE_LIMITS`, `GraphKeyKind`, `GraphKeyInput`, `ImportHeaderProblem`, `importHeaderProblems`, `importRowItem`, `importColumnOf`, `importErrorCodeOfParser`, `importErrorScope`. The three not-built error classes are gone.
4. C98.2 "field, by the field's type": a list has a `field-key` and no type, an item's `field-value` is text, and an inquiry field is a string, number or boolean. So the value's form decides, the same way for an item and a probe: a number and a text that reads as a canonical decimal meet on the decimal, and `007`, `1e3` and `+7` stay text. A cost: a string field holding `1.50` meets one holding `1.5`.
5. C98.2 government ID probe: a probe with no class sends `*` and every C31 class, not only `*`, because a stored `passport|X` is still a match for a probe with no class, and "no match" would be false.
6. C98.2 name keys: "both ICAO 9303 folds" holds for `native` and `icao` tokens. A lossy token (Arabic, `any-ascii`) keys on its normalised original, because `王` and `汪` both read `wang` and a key match is exact and R-tier (ADR 0005). So a Latin spelling of a Han or Arabic name meets it only through the fuzzy method.
7. C98.2 name keys: a generational suffix stays in the exact last name (`John Smith Sr` is not `John Smith Jr`) and leaves the last-name candidates. A name needs both parts: first-name-only and last-name-only values are refused, and a name the analysis would cut (over 300 characters, or 32 tokens) is `out_of_range`.
8. C98.2 phone: `isPossible()` is required and `isValid()` is not, because a list may hold numbers in ranges the metadata lacks. An international number ignores the list's region, so a region without a numbering plan (`AQ`) does not refuse it.
9. C98.2 email: a domain item refuses a whole address, which would list every mailbox of the domain; a trailing root dot is dropped; a probe with no `@` is refused.
10. C100.6: the neutraliser also goes before a cell that starts with apostrophes and then a formula character (`'=x` becomes `''=x`), and `stripNeutraliser` strips one past the same run. Without it, an export of `'=x` would re-import as `=x`, against C100.5. Numbers and booleans are not neutralised.
11. C100.3: `match_type` and `id_class` are required as columns (a missing column refuses the file) with an empty cell allowed, as the plan's "missing column" reads.
12. C101.2 `address`: "the Phase 5 address normaliser" cannot be called, because `readAddress` and `canonicalSubdivision` are private to `packages/checks/src/matching/addresses.ts`, outside my paths, and that comparison has no canonical form (`ave` is `avenida` or `avenue`). `packages/checks/src/lists/address-key.ts` builds the key from the exported C58.4 primitives: each word as its class's canonical with the most spellings. `subdivisionOf` repeats `canonicalSubdivision`'s six lines. `Ct` and `Court`, `Pl` and `Place`, `W` and `West`, and joined German suffixes give no link, never a false one. Proposed amendment: export `canonicalSubdivision` from `addresses.ts`, then drop the copy.
13. C101.2 `postal_code` keys the bare code with no country, because a graph parameter is one string. `email_domain` refuses a free-mail domain in the key function, so an indexer cannot forget the exclusion.
14. C97.1 and the contract disagree on the radius: the plan says 1 to 500,000, and `radiusMeters` in `packages/contracts/src/lists.ts` is `.positive()`, so 0.5 passes the schema and the normaliser answers `out_of_range`. Proposed amendment: `.min(1)`, integration-7b's or the contract owner's.
15. The seal-plus-HMAC script is not committed: no path I own may import `@openverify/db`. Its text is in `docs/tdd/phase7-list-logic.tdd.md` §4.

### Followups

1. Whole-repo gate: `pnpm turbo run lint typecheck --force` was still red on its fourth run, only outside my paths: `@openverify/db#lint` at `packages/db/src/identifier-key.test.ts:89` (no-unnecessary-type-assertion, committed in `10df6b79`, `foundation-7b`) and `@openverify/dashboard#typecheck` at `apps/dashboard/src/components/operators/settings-view.tsx`, while `foundation-7b` changes the settings. Earlier runs also failed in its uncommitted API list files. 28 of 30 tasks passed, `@openverify/checks` and `@openverify/watchlist` among them. `pnpm format:check` passed on the last run. Whoever closes Stage 1b must re-run the gate; it has not passed.
2. `api-graph`: a graph parameter is one string of at most 1,024 characters, but `graphNameKeyInputs` and `graphNameBirthdateKeyInputs` take `name-first` and `name-last`, and `address` takes six members. Decide how a parameter of those kinds binds (for example `Family, Given`), or refuse it at publish. Nothing here guesses a split.
3. `api-lists`: the geolocation box of `list_item_geo` (rounded outward to 0.01°, two rows across ±180°) is not a key and is not in this folder. Build it from the item's numbers, which `importRowItem` reads; the key's text does not give it.
4. `integration-7b`, `docs/lists/`: state OWASP's warning that no escape is safe for every spreadsheet, that the string rule's `toLowerCase()` is not a full case fold, the `field` form rule, that an exact name key takes each name whole in one fold (`Jurgen Mueller` does not meet `Jürgen Müller` exactly), and that lossy scripts need a fuzzy list.
5. Owner or Phase 11: `address-key.ts` could read `W`, `Ct` and `Pl` alike with a per-country language choice, which needs a quality calibration; it is a recall gain only.

### Measurements

All under `/tmp/openverify-e2e.lock` with the load beside it, Node 22.22.1, one thread, 100,000 rows × 5 rounds, median.

- Load before 2.89 3.49 3.66, after 3.00 3.44 3.63.
- Email: 40.84 µs per row (normalise 1.64, HMAC 7.91, seal 32.84; fastest 38.87, slowest 46.14); 281 B per row stored.
- Phone: 48.18 µs per row (11.98, 6.82, 29.37; 45.84 to 61.37); 235 B per row.
- Name: 55.12 µs per row (10.06, 13.63, 29.67; 51.58 to 55.51); 327 B per row, 2.00 keys per row.
- Against the research's 35 µs and 191 B per row (which kept a raw 32-byte key): a 100,000-row import spends about 4 to 5.5 s here before its inserts.
- `@openverify/checks`: 3,787 tests in 180 files, 98.79 / 91.65 / 99.41 / 98.76; `src/lists` 100 / 96.51 / 100 / 100; 20.4 s.
- `@openverify/watchlist`: 759 tests in 69 files, 98.63 / 90.2 / 99.15 / 98.61; `src/list-keys` 100 / 93.75 / 100 / 100; 209 s.
- New tests: 321 in `packages/checks/src/{lists,csv}/` and 35 in `list-name-keys.test.ts`.
