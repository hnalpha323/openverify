# Business watchlist report (`report/business-watchlist`)

Screens a company, a vessel or an aircraft against the selected sanctions lists, by name and by identifier. **Tiers:** R for the lists and the exact identifiers; H for the name score. **Stage:** `beta`. See [the reports overview](README.md) for what every type shares.

## What a result means

- `ready` with `has-match: true`: an entry matched by name at or above the minimum, or by an exact identifier whatever the name says (`identifier_exact`). `matched-lists` lists the entries with their kind, countries, programmes and identifiers; `sanction-list` repeats the lists in the public shape.
- `ready` with `has-match: false`: every selected list was screened and no entity matched.
- `fitness-probity-list` and `warning-list` are always `null` and listed in `unavailable-fields` with `list_not_configured`: those lists are not built, and an empty array would read as "nothing found". `lists-searched` names what was searched.
- **This is not ownership screening.** A company owned 50% or more by a listed party is not found unless it is listed itself; every result carries the `no_ownership_screening` notice.

## Query

`term` (1–300 characters), `address-country-code`?, and the identifiers, each matched exactly: `registration-number`? (within the address country), `lei`? (ISO 17442 check), `website`? (by host), `swift-bic`? (first 8 characters), `imo-number`? (with its check digit), `mmsi`?, `aircraft-serial`?, `aircraft-tail`?. A completion report takes the passed business registry record's legal name, registration number and LEI first.

## Configuration

As the [watchlist report](watchlist.md#configuration), without the birth date and gender settings, and:

| Key | Default | Meaning |
|---|---|---|
| `name-matching` | `{ preset: strict }` | The public business default. |
| `country-fields` | registration, address | The entry's countries compared with `address-country-code`. |
| `entity-kinds` | `[entity]` | Which entries are screened by name: `entity`, `vessel`, `aircraft`. An IMO, MMSI or aircraft identifier searches vessels or aircraft whatever this says. |

## How it screens

Business names go through the C58 normaliser and a table of legal forms (generated once from rigour's `org_types.yml`, MIT, 433 forms), read at both ends of the name and compared by their generic kind, so "Holdings Ltd" and "Holdings Limited" agree. Generic words (holdings, group, trading and the like) weigh half and, like legal forms, give no retrieval key. Candidates are retrieved as for the [watchlist report](watchlist.md#how-it-screens): name keys within the bound (pairs of distinctive words included), trigrams, and identifiers, matched exactly through their own index. Coverage and truncation read the same: complete coverage does not promise a spelling or a transliteration of the company name the matcher does not know ([what it does not promise](watchlist.md#what-a-result-means)).

## Sandbox

The synthetic list's company "Sandbox Sanctioned Holdings Ltd" (`SBX-2001`, LEI `5299000SANDBOXLEI047`, registration `SBX00000001` in GB) and the vessel "Sandbox Voyager" (`SBX-3001`, IMO `9999993`, MMSI `100999993`). See [the sandbox providers page](../checks/sandbox-providers.md#phase-6-reports).

## Events

`report/business-watchlist.ready`, `.errored`, `.matched`, `.dismissed`, `.reviewed`, `.redacted`.
