# Adverse media report (`report/adverse-media`)

Searches news titles for a person's name beside a crime or risk term. **Tiers:** H for the relevance, A for the search itself (the `adverseMedia` provider). **Stage:** `beta`. See [the reports overview](README.md) for what every type shares, and [business-adverse-media.md](business-adverse-media.md) for companies.

## What a result means

- `ready` with `has-match: true`: at least one article title holds the person's whole name in order, or every token of it, and at least one category term. Each article is listed with its URL, domain, `seen-date`, language, source country, its categories, a score and a confidence, which is capped at 0.6. An article whose language GDELT does not name is served with the language `und`, the BCP 47 and ISO 639-2 code for undetermined (the console reads it "Undetermined"), and its title is read with all four lexicons.
- `ready` with `has-match: false`: no title in the window matched. **This says no title mention, not no coverage anywhere.** `coverage` is never complete: its limits are always `title_only` (relevance is read from titles only), `window_90_days` (GDELT's rolling three months) and `lexicon_languages` (the terms are in English, Spanish, French and German), and every result carries the `media_coverage_limited` notice. A search that filled GDELT's 250 records is `truncated`, and errors `result_truncated` when nothing matched.
- `errored` with `provider_not_configured`: no `adverseMedia` provider is bound. That is the default.
- An article is a lead. The name may be someone else's, and the title is not the article.

## The provider

- **`gdelt-doc`:** the GDELT DOC 2.0 API in `artlist` mode, sorted by relevance, with at most 250 records over its rolling three months. Binding it needs `OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE=true` (every screened name goes to GDELT; see [the disclosures](README.md#what-each-adapter-receives)). The query is built only from the name's letters and digits inside one quoted phrase, the template's category terms as one `OR` group, and a `sourcecountry:` filter from a fixed table when the query names a country, so nothing a user typed can change the search. A full answer is asked again once with the country filter.
- **Budget:** one request every 5 s install-wide, as GDELT asks, shared among the environments that asked in the last minute. A run that cannot take a turn waits (the run stays `pending` with a `not_before`) and ends `errored` with `provider_error` after 24 h. Scheduled media runs are capped per environment (`OPENVERIFY_REPORTS_MAX_MEDIA_RUNS_PER_DAY`). The sources page shows the environment's own scheduled media runs per day beside the budget, and warns when the whole install's runs pass 80% of it, without showing the other environments' total.
- **Nothing is cached:** a title holds the screened name beside a crime term, so every run asks again. Only the URL, domain, date seen, language, source country and a 200-character title are stored (sealed), never the article's body, an image or a snippet. The title is shown only as link text.
- Results cite GDELT, as its terms ask.

## Relevance and score

The lexicon (`packages/checks/src/reports/media/`) holds 352 authored terms in four languages across twelve categories: financial crime, fraud, corruption, money laundering, terrorism, organised crime, narcotics, violent crime, cybercrime, property crime, regulatory and financial difficulty. A title is read with the lexicon of its language, or all four when its language is unknown; another language is dropped. There are no criminal-procedure words (arrested, charged, convicted), so a title with only those does not match.

Score = 0.5 × the name (1.0 for the whole name in order, 0.8 for every token) + 0.3 × the highest category weight (the FATF predicate offences 1.0, violent crime and cybercrime 0.9, property crime 0.8, regulatory 0.7, financial difficulty 0.5) + 0.2 × recency (1.0 falling to 0.5 at the age limit). Confidence = 0.6 × score. Every weight is provisional.

## Query and configuration

Query: name parts or `term`, `birthdate`?, `country-code`?, `additional-names`? (every name is in the one search). A name with no letter or digit left is refused at creation (422 `report_query_invalid`); a completion run errors `insufficient_input`.

| Key | Default | Meaning |
|---|---|---|
| `categories` | all twelve | The terms searched and the categories that count. |
| `max-article-age-days` | 90 | Measured on `seen-date` (when GDELT saw the article: it gives no publication date). |
| `allowed-countries` | any | Keeps only articles from these source countries. |

Review per article (`dismiss-type: media`) or for every article (`entity`).

## Sandbox

The sandbox provider calls nothing and takes no budget: a screened name holding `sandbox-media` (or the tokens `sandbox` then `media`) gets two synthetic articles under `sandbox-news.example`, seen 1 and 10 days earlier. See [the sandbox providers page](../checks/sandbox-providers.md#phase-6-reports).

## Events

`report/adverse-media.ready`, `.errored`, `.matched`, `.dismissed`, `.reviewed`, `.redacted`.
