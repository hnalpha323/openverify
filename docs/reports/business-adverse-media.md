# Business adverse media report (`report/business-adverse-media`)

Searches news titles for a company's name beside a crime or risk term. Everything in [the adverse media report](adverse-media.md) applies (the provider, the budget, the window, the lexicon, the coverage and the score); this page gives what differs. **Tiers:** H, A. **Stage:** `beta`.

## What a result means

As for persons: `ready` with `has-match: true` when an article title names the company beside a category term under the rules below; `ready` with `has-match: false` means no title mention in the 90-day window, never "no coverage anywhere" (the coverage is never complete); `errored` with `provider_not_configured` when no provider is bound. An article whose language GDELT does not name is served with the language `und` (undetermined), and its title is read with all four lexicons.

## Business names

Articles rarely carry a legal form, so it is removed first ("Ltd", "GmbH", "S.A." and the rest of the legal-form table). Then:
- an article matches only with the full distinctive phrase **and** either the query's country (the article's source country, or the country's name in the title) or a second distinctive word;
- a name that is one generic word once its legal form is removed ("Holdings Ltd", "Trading Ltd") is refused at creation with 422 `report_query_invalid`, and a completion run errors `insufficient_input`, because such a name would match every company of that kind;
- a name made of two or more generic words is accepted but needs the country.

Generic words include holdings, group, trading, media, bank and the like.

## Query

`term` (the company name) and `country-code`?. A completion report takes the passed business registry record's legal name first, then the entered business name.

## Sandbox

As for persons, a name holding `sandbox-media` gets two synthetic articles, but the sandbox articles name no country, so the name also needs a second distinctive word: "Sandbox-Media Quarrystone Holdings Ltd" matches, "Sandbox-Media Holdings Ltd" does not. The sandbox is not special-cased.

## Events

`report/business-adverse-media.ready`, `.errored`, `.matched`, `.dismissed`, `.reviewed`, `.redacted`.
