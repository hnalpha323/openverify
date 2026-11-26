# Phone number report (`report/phone-number`)

Facts about a phone number from its numbering plan, a risk level, and, with a provider bound, its network line type, carrier and SIM swap. **Tiers:** R for the numbering plan; H for the level; A for the network data (`phoneIntelligence`). **Stage:** `beta`. There is no review. See [the reports overview](README.md) for what every type shares.

## What a result means

| Field | Meaning |
|---|---|
| `phone-country-code`, `phone-is-possible`, `phone-is-valid` | From libphonenumber's full metadata. |
| `phone-type-numbering-plan` | What the numbering plan says (ours). |
| `phone-type` | `FIXED_LINE`, `MOBILE`, `TOLL_FREE`, `VOIP` (numbering-plan VoIP only), `PAGER`, `PERSONAL`, `VOICEMAIL`, `RESTRICTED_PREMIUM` (premium, shared cost, UAN) or `INVALID`. For every ordinary US and Canadian number the plan answers `FIXED_LINE_OR_MOBILE`: `phone-type` is then `null` with `line_type_undetermined`, because `OTHER` is a carrier's definite answer and is never reported from the plan. With a provider bound, the network line type replaces the plan's (non-fixed VoIP reads `VOIP`, fixed VoIP and landline `FIXED_LINE`). `PREPAID`, `PAYPHONE` and `OTHER` come only from a provider, with the reasons `prepaid`, `payphone` and `other_line_type`. |
| `phone-network-line-type`, `phone-carrier` | From the provider. |
| `phone-risk-sim-swap` | From the provider: within 24 h `high`, 7 days `medium`, 30 days `low`, older `very-low`; not checked reads `N/A`. |
| `phone-ported-recently` | From the provider. |
| `phone-reachable-at-otp` | Ours: as for email, only for a completion report whose inquiry confirmed this number with a code; `not_linked` for any other origin. |
| `phone-risk-score` | Always `null`: no 0–1,000 score is synthesised. |

## The risk level (H)

| Line type | `phone-risk-level` / `phone-risk-recommendation` | Confidence |
|---|---|---|
| `INVALID` | `high` / `block` | 0.95 |
| `RESTRICTED_PREMIUM`, `TOLL_FREE`, `PAGER`, `VOICEMAIL` (the types Phase 5 refuses for a one-time code) | `high` / `block` | 0.9 |
| `VOIP` | `medium-high` / `block` | 0.7 |
| `PREPAID` (provider only), reason `prepaid` | `medium` / `flag` | 0.4 |
| `PAYPHONE` (provider only), reason `payphone` | `medium` / `flag` | 0.4 |
| `PERSONAL` | `medium-low` / `allow` | 0.5 |
| `MOBILE`, `FIXED_LINE` | `low` / `allow` | 0.5 |
| undetermined (`FIXED_LINE_OR_MOBILE`, no provider) | `low` / `allow`, with `line_type_undetermined` stated | 0.3 |
| `OTHER` (provider only), reason `other_line_type` | no level of its own: `null` unless a SIM swap within 24 h sets `high` | — |

With a provider, a SIM swap within 24 h gives `high` (0.8), within 7 days `medium-high` (0.6), and a port within 30 days `medium` (0.4). The level is the worst reached, with the highest confidence among the reasons at that level. The recommendation follows the level: `low` and `medium-low` allow, `medium` flags, `medium-high` and `high` block. `OTHER` is a definite answer from the provider, but nothing says how risky it is, so it is stated and sets no level: the level stays `null` (`undetermined` in `unavailable-fields`) unless a SIM swap within 24 h already reached `high`, the top of the scale, which nothing unread could exceed. The same holds for a valid number whose plan gives no type, and for a provider that failed. Each result carries its confidence, its reasons, the provider and the thresholds. Every value is provisional.

### Basis of each constant

| Constant | Value | Basis |
|---|---|---|
| `INVALID` | `high`, 0.95 | The plan's table (research `phase6-risk-reports.md` §2.3): a number that is not valid cannot receive a code. |
| `RESTRICTED_PREMIUM`, `TOLL_FREE`, `PAGER`, `VOICEMAIL` | `high`, 0.9 | The same table: the set Phase 5 refuses for a one-time code (C55.8). |
| `VOIP` | `medium-high`, 0.7 | The same table: non-fixed VoIP numbers are cheap to obtain in bulk. |
| `PREPAID` | `medium`, 0.4 | Owner decision 14 (ours): the public mapping flags a prepaid line. Many people use prepaid lines, so it is weak evidence, weighed as a recent port. |
| `PAYPHONE` | `medium`, 0.4 | Owner decision 14 (ours): rare for a person verifying, but not fraud evidence by itself, so weighed as a recent port. |
| `PERSONAL` | `medium-low`, 0.5 | The plan's table. |
| `MOBILE`, `FIXED_LINE` | `low`, 0.5 | The plan's table: an ordinary line. |
| undetermined | `low`, 0.3 | Decision 51: both possible plan types are low on this rule, with a lower confidence. |
| `OTHER` | no level | Owner decision 14 (ours): the provider names a line type the table has no row for, so no level is claimed. |
| SIM swap within 24 h, 7 days | `high` 0.8, `medium-high` 0.6 | Ours (C82.2): the research leaves the windows to us; a recent swap is takeover evidence, weaker after a day. |
| port within 30 days | `medium`, 0.4 | Ours (C82.2): people port numbers when they change carrier, so it is weak evidence. |

## Sandbox

The sandbox provider answers numbers in the NANP fictional range `+1 NPA 555 01xx` by their last two digits: `00` mobile, `01` non-fixed VoIP, `02` prepaid, `03` mobile with a SIM swap 6 hours ago, `04` ported 10 days ago, `05` unreachable, `06` fixed VoIP; any other number is not checked. See [the sandbox providers page](../checks/sandbox-providers.md#phase-6-reports).

## Events

`report/phone-number.ready`, `.errored`, `.redacted`.
