# AAMVA vectors (C33, C36)

Cross-language test vectors for the PDF417 payload of US and Canadian driver licences and ID cards, in the layout of the AAMVA DL/ID Card Design Standard (2020), Annex D (Tables D.1-D.4). The TypeScript AAMVA parser (`packages/checks`, Workflow 3A `checks-logic`) and the barcode-only fixture images (`fixtures`) use these files; `packages/checks/src/vectors.test.ts` keeps them consistent.

**Every payload is synthetic.** The people are fictional, no jurisdiction issued the payloads, and each carries a jurisdiction-specific subfile that marks it as OpenVerify test data (C36). They are rendered only as barcode-only images on a plain background, never onto a card. The element tables here are written by us; the standard's text is © AAMVA and is not copied.

| File | What |
|---|---|
| `valid.json` | Payloads that parse and validate, each with its expected parse |
| `invalid.json` | Payloads that must not validate, each with the error a parser reports |

## Payload layout (Annex D)

- **Header** (21 bytes): `@` (compliance indicator), LF, RS (`0x1e`), CR, `ANSI ` (file type), the 6-digit IIN, the AAMVA version (`10` for the 2020 standard), the jurisdiction version (`00`), the number of entries (`02`).
- **Subfile designators**, 10 bytes each: the subfile type (`DL`, `ID`, or a jurisdiction-specific `Z?`), the offset of the subfile from the first byte of the payload (4 digits), and its length (4 digits, counting its 2-character type and its CR terminator).
- **Subfiles**: the type, then the elements (3-character id and value) separated by LF, then CR.
- **The synthetic marker**: a jurisdiction-specific subfile `Z?` (`Z` and the jurisdiction's first letter: `ZC` for California and Colorado, `ZO` for Ontario, `ZT` for Texas) with the single element `Z?A` = `OPENVERIFY SYNTHETIC TEST DATA`.
- **Versions**: AAMVA version `01` (2000) has no jurisdiction version, so its header is 19 bytes; versions `02` to `10` have one. No other version exists.

## Vector format

Each file is `{ schema_version: 1, description, source: { citation, url }, vectors: [...] }`. A vector has `id`, `note`, `payload` (the exact string; JSON escapes the control characters) and `valid`. A valid vector also has:

- `header`: `{ compliance_indicator, file_type, iin, aamva_version, jurisdiction_version, number_of_entries }`;
- `subfiles`: `[{ type, offset, length }]`, as the designators state;
- `elements`: per subfile type, element id to raw value (trailing spaces kept, for example `DAK`);
- `synthetic_marker`: `true`; `document_type`: `DL` or `ID`; `real_id_compliance`: the `DDA` value (`F` compliant, `N` not);
- `fields`: the expected C31.5 extraction, with these conventions: US dates are `MMDDCCYY` and Canadian dates `CCYYMMDD` (by `DCG`, else the IIN's country), and both become `YYYY-MM-DD`; `DBC` 1/2/9 becomes `M`/`F`/`X`; a `DAD` of `NONE` (no middle name) becomes `null`; `DCB` and `DCD` keep `NONE`, a value the card states; a 9-digit US postal code ending in `0000` (unknown ZIP+4, Annex D) becomes the 5-digit ZIP, any other 9-digit one `ZIP-PLUS4`, and a six-character Canadian one `A1A 1A1`; trailing spaces are dropped; `DCG` `USA` gives `address-country-code` `US`; `issuing-authority-code` is the IIN; AAMVA has no `nationality`.

An invalid vector has `error` and `details`:

| `error` | Meaning | `details` |
|---|---|---|
| `aamva_header_invalid` | Not an AAMVA header | `{ field }` |
| `aamva_subfile_designator_invalid` | A designator's offset or length falls outside the payload | `{ subfile }` |
| `aamva_mandatory_element_missing` | A Table D.3 mandatory element is absent; the structure still reads | `{ elements }` |
| `aamva_date_invalid` | A date element is not a calendar date | `{ element }` |
| `aamva_iin_unknown` | The IIN is not on the AAMVA list (`packages/checks/src/data/aamva-iins.ts`); the structure still reads | `{ field: "iin" }` |
| `aamva_version_unsupported` | The AAMVA version is not 01-10; the structure still reads | `{ field: "aamva_version" }` |

A parser raises the first two (`aamva_header_invalid`, `aamva_subfile_designator_invalid`) as structural errors and reports the others as issues of a payload that still reads. A payload without a `DL` or `ID` subfile reads but reports `aamva_document_subfile_missing`.

`checks-logic` owns this directory from Workflow 3A Stage 2. It added a Canadian payload, a version 08 payload with a full ZIP+4, and invalid payloads for a wrong compliance indicator, an unlisted IIN, an unknown version and a misplaced subfile.
