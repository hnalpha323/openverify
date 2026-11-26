# Address lookup report (`report/address-lookup`)

Normalises a postal address and checks what can be checked offline; with a provider bound, verifies a US address with the postal service's data. **Tiers:** R for the normalisation and the offline checks (and a hint, H); A for the verification (`addressVerification`). **Stage:** `beta`. There is no review. See [the reports overview](README.md) for what every type shares.

## What a result means

| Fields | Meaning |
|---|---|
| `resolved-*` | The components through the C58 normaliser, labelled `normalised` in provenance: never postal-corrected. |
| `postal-code-valid` | Against libaddressinput's postcode patterns. |
| `zip-state-consistent` | US only: the ZIP code's prefix belongs to the state (libaddressinput's prefixes, CC BY 4.0, attributed in `packages/checks/data/reports/NOTICE`). |
| `address-designators` | PO box (`po_box`), military (`military`: APO, FPO, DPO), private mailbox (`pmb`) and general delivery (`general_delivery`) designators found in the lines. General delivery (USPS) or poste restante (UPU) is mail held at a post office for the addressee to collect, so the address is not where the person receives mail at home. It is stated, never scored: the address report has no risk level (owner decision 3). |
| `cmra-hint` | Ours (H, confidence 0.6): a keyword hint of a commercial mail receiving agency. It is never put in a USPS-derived field. |
| `deliverability`, `metadata-*`, `analysis-*` | From the provider: the DPV match, the residential delivery indicator, CMRA, vacancy, LACSLink, SuiteLink, carrier route, county and precision. A US address without a bound provider leaves them `null` with `provider_not_configured`; any other country with `unsupported_country`, and nothing is sent. |

## The provider

`smarty` (the US Street API) receives the normalised components of a US address only, never the addressee unless the template sets `send-addressee: true`. There is no USPS adapter (USPS limits its APIs to shipping and mailing) and no OpenStreetMap geocoder (ODbL). See [the disclosures](README.md#what-each-adapter-receives).

## Query and configuration

Query: `addressee`?, `address-street-1`, `address-street-2`?, `address-city`, `address-subdivision`, `address-postal-code`, `address-country-code`. Configuration: `send-addressee` (`false`).

## Sandbox

The sandbox provider answers a US address by its house number, the first word of `address-street-1`: `1000` confirmed and residential, `1001` confirmed and commercial, `1002` not confirmed, `1003` a CMRA, `1004` vacant, `1005` secondary missing, `1006` secondary invalid; any other number gives `deliverability: unknown`. See [the sandbox providers page](../checks/sandbox-providers.md#phase-6-reports).

## Events

`report/address-lookup.ready`, `.errored`, `.redacted`.
