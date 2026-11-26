# The DPIA and its inputs

This is not legal advice.

Not reviewed by counsel.

A data protection impact assessment is the operator's. This page lists what the repository gives one, and the processing an assessment of an OpenVerify install should cover.

## When one is needed

The UK GDPR's Article 35 (re-read on 2026-11-20, [S2](sources.md)) asks for an assessment before processing likely to result in a high risk, and names three cases among others: a systematic and extensive evaluation of personal aspects by automated processing, profiling included, on which decisions with legal or similarly significant effects are based; large-scale processing of special-category data; and large-scale systematic monitoring of a publicly accessible area. At minimum it describes the processing and its purposes, assesses necessity and proportionality, assesses the risks to people, and sets out the measures that address them. The EU's Article 35 has the same structure (**not re-read on 2026-11-20: EUR-Lex returned no text**, [S1](sources.md)). In our reading identity verification with face matching usually meets the second case, and automated decisions on it may meet the first.

## Inputs the repository provides

| Input | Where | What it gives the assessment |
|---|---|---|
| The threat model | [threat model](../security/threat-model.md) | Threats per trust boundary with their controls and open gaps (self-assessed) |
| The data classification | [data classification](../security/data-classification.md) | Each class of data, where it is stored and whether it is sealed |
| The check catalog | [checks](../checks/catalog.md) | Every check: its tier (R, H or A), its stage (`beta` for heuristics), its inputs and what a result means |
| The record of processing | [record of processing](record-of-processing.md) | A generated template of the processing and the recipients |
| The security checklists | [security](../security/README.md) | The ASVS and MASVS rows with their evidence (self-assessed) |
| Calibration reports | `docs/calibration/` | Measured error rates of the face match and the lists, with their limits |
| Automated decisions | [automated decisions](automated-decisions.md) | What is recorded and refused for a decision a workflow makes |

## Processing to cover

- **Biometric data**: the selfie face match, face templates and the 1:N repeat scan, face and background lists ([biometric data](biometric-data.md)).
- **Device recognition**: off by default; an operator who turns it on carries a DPIA for it (ADR 0006, `docs/adr/0006-signals-honesty-collection-tiers-and-network-data.md`; [device and network data](device-and-network.md)).
- **The graph is profiling**: an operator who turns it on records in the DPIA its purpose (fraud rings, duplicate accounts), the kinds it indexes, the retention of stored results and who may unmask; weak kinds and components are off by default because they link people on little evidence ([graph](../graph/README.md); [lists, the graph and transactions](lists-graph-transactions.md)).
- **Lists** hold third-party data about people who need not be subjects ([lists, the graph and transactions](lists-graph-transactions.md)).
- **Automated decisions** made by workflows on check results ([automated decisions](automated-decisions.md)).
- **Sharing** between organisations through Connect ([sharing](sharing.md)).
- **Recipients**: each provider you bind ([recipients](recipients.md)).

## What the inputs do not do

They describe the software. They do not know your purposes, your volume, your users or your other systems, and they are self-assessed, not audited. An assessment that copies them without that context is incomplete.
