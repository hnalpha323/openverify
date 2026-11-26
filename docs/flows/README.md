# Flows (flow-spec 2)

An inquiry template version holds a **flow**: the steps a person goes through, and which step follows which. Phase 9 (Workflow 9A) replaced the list of fixed screens of flow-spec 1 with flow-spec 2, a graph of steps joined by port-labelled edges, decided on the server. The rules come from [ADR 0008](../adr/0008-flows-server-decided-branching-embedding-and-preview-origins.md):

- the server decides every step a person sees and every verification they must pass; a client renders the step it is given and never chooses a path;
- a condition over a missing or unknown fact never takes a branch silently: an unknown path is refused at publish, and a nullable fact is routed by an `onNull` the author chose;
- a flow never runs operator code or reaches the network: code and HTTPS calls stay in [workflows](../workflows/README.md);
- who may frame which document is decided by response headers per request, failing closed, and every cross-origin message names its exact origin;
- a heuristic read by a branch keeps its tier and stage, and a path that fails a person on anything but a verification's own outcome is acknowledged and, in production, carries a basis and a contest route.

| Page | What it covers |
|---|---|
| [Format, versions and migration](format.md) | the v2 document, its caps and graph rules, the hash, the lossless migration from v1 |
| [Steps and components](steps.md) | step types and ports, the `screen` step and its components, fields and prefill |
| [Branching](branching.md) | the flow scope, conditions, `onNull`, waits, fallbacks, acknowledgements |
| [Actions](actions.md) | the five action kinds, `run_workflow` and its grants, the error codes |
| [The server engine](engine.md) | the position, the step record, required verifications, the session API, `flow-outcome`, today's Android SDK |
| [Preview and simulate](preview-and-simulate.md) | the credential-free preview, its protocol, the resolve route, simulate and its presets, and what a simulation does not do |
| [Embedding and redirects](embedding.md) | allowed origins, the embed rules, redirects |
| [The flow server](server.md) | its entries and headers, the lookup, the limits, how to run it |
| [`@openverify/js`](js.md) | the embed client and its message protocol |

Translations, operator copy and the locales are in [docs/i18n](../i18n/README.md); the hosted flow's other pages are in [docs/flow](../flow/README.md).

**Built since Workflow 9A** (Workflow 9B, plan "Handover to 9C"): simulate and the simulation presets (C156.4), the preview's resolve route (C156.1), the publish-time checks of a version's own `embed-origins` and `redirect-uri` (C158.2, C158.4; both are still re-checked against the environment's lists on every use), flow-spec 2 on `POST /inquiry-templates`, and the session's `theme` and `links`. The console's builder, preview and simulate pages are Workflow 9C's (`apps/dashboard/README.md`). What is still open is listed in the plan's Workflow 9C Stage 2 amendments (S9C-12) and its Handover to 9D.
