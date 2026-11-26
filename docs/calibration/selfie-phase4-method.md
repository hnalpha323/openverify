# Face-match calibration: how the set was built and reviewed (Phase 4, C49.1)

This is the method behind `docs/calibration/selfie-phase4.md`. That report is generated from the measurements and holds every number. This page records how the set was chosen, reviewed and measured, and the decisions taken along the way. It names no one: identities are pseudonymous (`p0001`), and only the file URLs in `fixtures/calibration-manifest.json` carry names.

## The set

`python3 scripts/fetch_fixtures.py --harvest-calibration` built `fixtures/calibration-manifest.json` on 2026-10-22 (UTC) from the Commons and Wikidata APIs. The rules are in the script and its tests (`services/vision/tests/test_fetch_fixtures_harvest.py`). They read metadata only, never a score.

- **Sources:** the files of three Commons categories and their subcategories, three levels down: official portrait photographs of NASA, of the U.S. Department of State, and of the U.S. Armed Forces.
- **Licence:** a `PD-USGov-NASA`, `PD-USGov-DOS` or `PD-USGov-Military*` template. A file is left out when it also carries any of these:
  - `Personality rights`;
  - a Congress template (Congress portraits need a per-file credit check, so they are out entirely);
  - a Creative Commons or GFDL licence;
  - a deletion tag.
- **Files:**
  - JPEG originals of at most 40 MB;
  - not a title announcing a crop, a crew, a group, a poster, a class, a collage, a team, or several people ("and", "&");
  - not a category announcing several people ("Group portrait photographs with 6 persons", "2 men in ...");
  - not a category naming two people.
- **One person per file:** the people the file's structured-data *depicts* (P180) names and the people its visible categories name must be exactly one Wikidata human item, and all must agree. A category names a person in one of two ways:
  - its own Wikidata item is that human, or a category item whose single main topic is that human;
  - it is "<Name> in ...", "<Name> by ..." or "(Official) portraits of <Name>" under an ancestor category (at most four levels up) that names the human.

  A category about a person's administration names no one.
- **Distinct photos:** one copy of each Commons SHA-1 (the earliest upload keeps it). At most five photos per person, spread over the years so that no identity outweighs the others; at most 10 genuine pairs each. Only people left with two photos or more are kept.
- **Pinning:** each original is downloaded once and checked against the size and SHA-1 Commons lists. It is pinned by its URL (query string stripped), the SHA-256 of its bytes, its size, Commons' SHA-1 and the file page's revision id. Sex comes from the person's Wikidata P21 (female, male, else unknown). The year comes from the file's date, else its structured-data inception.
- **Etiquette:**
  - every API request carries `maxlag=5` and the script's descriptive User-Agent, with no personal contact;
  - request starts are at least 1 s apart, with at most 2 in flight, and downloads are paced to 25 Mbps;
  - each request URL stays within 7,000 characters. The first live run got HTTP 414 for a batch of long titles, and the fetcher was fixed test-first.

**What the harvest left out**, of 11,240 files in the categories:

| Reason | Files |
|---|---|
| no single person named | 4,914 |
| licence (including personality rights and Congress) | 1,820 |
| person left with a single photo | 1,304 |
| title announcing several people or a derivative | 988 |
| not JPEG | 258 |
| over five photos of one person | 64 |
| several people (categories) | 58 |
| over 40 MB | 2 |

That leaves **707 identities and 1,832 photos**: 588 male, 117 female, 2 unknown, with a year on 1,649 photos. The licences are 700 `-Military-Army`, 459 `-NASA`, 243 `-DOS`, 197 `-Military-Air Force`, 128 `-Military` and 105 other `-Military-*`. `python3 scripts/fetch_fixtures.py --calibration` then verified every file (1,832 of 1,832, none missing). On the first harvest it had also re-downloaded three removed files from Commons, checking their digests.

## The two tails reviews

The review covers the 30 lowest genuine pairs and the 30 highest impostor pairs (the counts were fixed before any score was seen). They are shuffled with a seed and shown without scores, with each file's Commons title, description, visible categories and depicts. An exclusion needs metadata showing another person or a misattribution, never a low score or a look.

1. **The first review**, on the first harvest, found systematic grouping errors in the identity rules, not one-off mistakes:
   - a category for one administration's personnel had been read as naming its president, so five different officials became one identity;
   - group photos whose depicts lists only one person;
   - two-person portraits whose second person's category sat three levels below their person category, beyond the two levels then walked;
   - a title naming three people.

   Pinning exclusions for only the reviewed pairs would have left the same errors elsewhere. So the rules above were tightened test-first (the per-person category forms, four levels, the group and two-person categories, "and"/"&" titles) and the set was harvested again. The first harvest's scores were used for nothing: no FAR or FRR was computed on it.
2. **The second review**, on the final set, covered 60 pairs and 107 photos:
   - 106 photos were kept;
   - one was excluded as a **misattribution**: its depicts statement names one general, but its title and original caption are about another general, pictured with his wife and the first;
   - every impostor pair is two different people per metadata. One of them is a pair of identical twins, kept as two identities: a hard impostor pair, not a mistake.

   The decisions are pinned in the manifest's `review` field, and the report gives FRR before and after (one genuine pair removed).

## The measurement

`services/vision/tools/calibrate_selfie.py` decodes each photo upright, scales it to a 2,000-px long side, and measures the largest face with YuNet and SFace in process.

- **Near-duplicates:** the rules were fixed before any score was seen. An SFace cosine above 0.93, or an aligned-crop pixel correlation above 0.95, to an earlier kept photo of the same identity removed 84 photos. Four photos had no face.
- **Pairs:** every two kept photos of one identity form a genuine pair (1,574). The first kept photo of each identity, against the first of every other, forms an impostor pair (249,571).
- **Genuine cues:** the same tool analysed each kept portrait (re-encoded as JPEG q95 when scaled) and the 45 re-encodings of the public-domain test faces through the vision service's selfie route. That gives the heuristic cues' genuine distributions, which `SYNTHETIC_SIGNALS` was checked against.
- **Speed:** 16 minutes on the development machine.

## Privacy

- **Images:** the photos live only in `fixtures/faces/calibration/` (gitignored, and outside both Docker build contexts). The measurements live in `fixtures/generated/calibration/` (gitignored).
- **Embeddings and crops:** these exist only in memory during a run; a test asserts that the tool writes nothing else.
- **Review previews:** these were made in the same gitignored folder.
- **Metadata cache:** the harvest's API answers (public Commons and Wikidata metadata) were cached outside the repository for the run.
- **Purpose, lawful basis and takedown:** see the report.

## Limits of the set

- **Domain:** studio portraits, not selfies against ID card photos.
- **Who is in it:** adults in official roles, 83% male. The skin-tone proxy (ITA) is narrow, and per-group error rates are unmeasured.
- **Review coverage:** depicts statements and categories can still be wrong outside the 60 reviewed pairs. A wrong identity in a genuine pair inflates FRR. Two identities that are really one person inflate FAR, and none of the 30 highest impostor pairs was such a case.

## Summary block

Added in Workflow 11E by `docs-catalog` (a borrowed edit; Workflow 11E decisions item 16): this report's own figures, copied from the text above, in the shape of `contracts/fixtures/calibration/summary.schema.json`, so the check catalog (`docs/checks/catalog.md`) reads every report's figures one way. The text above is unchanged and remains the record; `head` is the commit that last changed it, and `owner` names the Workflow that measured it.

<!-- openverify:calibration-summary:start -->
```json
{
  "base": null,
  "head": "3f5e834c9b7b75006d6b8dbcd1747504ebae3a6d",
  "machine": null,
  "method-commit": null,
  "report": "docs/calibration/selfie-phase4-method.md",
  "rows": [
    {
      "budget": null,
      "configuration": "public-domain official portraits (NASA, the U.S. Department of State, the U.S. Armed Forces)",
      "contract": "C49.1",
      "gap": null,
      "id": "harvest-files",
      "median": 11240,
      "owner": "workflow-4b",
      "takes": [],
      "title": "Files in the three Commons categories read by the harvest",
      "unit": "count",
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "two photos or more per person, at most five",
      "contract": "C49.1",
      "gap": null,
      "id": "identities-kept",
      "median": 707,
      "owner": "workflow-4b",
      "takes": [],
      "title": "Identities kept (588 male, 117 female, 2 unknown)",
      "unit": "count",
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "before the near-duplicate rule and the review",
      "contract": "C49.1",
      "gap": null,
      "id": "photos-kept",
      "median": 1832,
      "owner": "workflow-4b",
      "takes": [],
      "title": "Photos kept by the harvest, each verified by its digest",
      "unit": "count",
      "verdict": "reported"
    },
    {
      "budget": null,
      "configuration": "SFace cosine above 0.93 or aligned-crop correlation above 0.95",
      "contract": "C49.1",
      "gap": null,
      "id": "near-duplicates-removed",
      "median": 84,
      "owner": "workflow-4b",
      "takes": [],
      "title": "Photos removed as near-duplicates by the rule fixed before any score was seen",
      "unit": "count",
      "verdict": "reported"
    }
  ],
  "schema": "openverify/calibration-summary@1",
  "status": "published",
  "workflow": "4B"
}
```
<!-- openverify:calibration-summary:end -->
