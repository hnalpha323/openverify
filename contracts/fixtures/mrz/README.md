# MRZ vectors (C33)

Cross-language test vectors for ICAO Doc 9303 machine-readable zones: the TypeScript parser (`packages/checks`), the Python fixture generator (`services/vision/tools/icao_mrz.py`) and Kotlin `Mrz.kt` (Workflow 3B) test against these files. `packages/checks/src/vectors.test.ts` keeps them consistent and checks them against our parser and against the `mrz` npm package (dev only, MIT).

| File | What |
|---|---|
| `icao-td1.json`, `icao-td2.json`, `icao-td3.json` | The published TD1, TD2 and TD3 examples of ICAO 9303 Parts 5, 6 and 4 |
| `icao-mrv.json` | The published MRV-A and MRV-B visa examples of Part 7 |
| `invalid.json` | MRZs that must not validate: check-digit failures (the fields still parse) and structural errors (they do not) |
| `ocr-corrections.json` | MRZ lines as OCR might misread them, with exactly the corrections C31.3 allows (or none) and the result |

The examples belong to the specimen state Utopia (`UTO`) and its specimen holder. Their document numbers are also on the C33 specimen marker list, so a real check must flag them; they are test data, never a happy path.

## Format

Each file is `{ schema_version: 1, description, source: { citation, url }, vectors: [...] }`. A vector has:

- `id`: unique across the directory;
- `format`: `TD1`, `TD2`, `TD3`, `MRVA` or `MRVB`; `null` when the MRZ does not parse;
- `lines`: the MRZ lines, exactly as printed or read;
- `note`: what the vector shows;
- `valid`: whether every check digit holds (and, for structural errors, `false`);
- `check_digits` (when the MRZ parses): per field (`document_number`, `birth_date`, `expiration_date`, `optional_data`, `composite`), `{ input, printed, computed, valid }`, where `input` is the exact character string the digit covers (ICAO 9303 Part 3 §4.9: weights 7, 3, 1; `<` is 0; A-Z are 10-35). A field the layout has no digit for is `null` (TD1 and TD2 have no optional-data digit; visas have no composite);
- `fields` (when the MRZ parses): `document_code`, `issuing_state`, `surname`, `given_names` (fillers inside a name become spaces), `document_number`, `nationality`, `birth_date` and `expiration_date` (`YYMMDD`, as printed), `sex` (`M`, `F`, or `X` for a filler), `optional_data_1` and `optional_data_2` (trailing fillers removed; `null` where the layout has no such field);
- `error` (structural errors only): the code a parser raises, `mrz_invalid_characters` or `mrz_unrecognized_format`.

The vectors of `ocr-corrections.json` have `id`, `format`, `lines` (as read), `note` and, instead of `check_digits` and `fields`:

- `corrections`: the corrections a parser applies under C31.3, in line and position order, each `{ line, position, field, from, to }` (0-based line and position; `field` names the MRZ field, for example `birth_date`, `birth_date_check_digit`, `issuing_state`, `name`, `composite_check_digit`). Only a character impossible for its position is corrected (a letter where the format needs a digit: `O`→`0`, `I`→`1`, `S`→`5`, `B`→`8`, `Z`→`2`, or the reverse where it needs a letter), at most one per field, never in a field that allows both (the document number, the optional data) or the sex field. An empty list means nothing may be corrected;
- `corrected_lines`: the lines after the corrections;
- `valid`: whether every check digit holds after them.

`checks-logic` owns this directory from Workflow 3A Stage 2. It added the Part 5 long document number example, an MRV-A check-digit failure and `ocr-corrections.json`.
