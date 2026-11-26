# Security policy

## Reporting a vulnerability

Please report a vulnerability through GitHub's private vulnerability reporting on this repository (the "Report a vulnerability" button of its Security tab), never in a public issue, a pull request or a commit message.

You can also open the form directly: <https://github.com/hnalpha323/openverify/security/advisories/new>. Only the maintainers can read a report. Please include what is affected (component and commit), how to reproduce it with the sandbox and synthetic data, and the impact you expect; never include real personal data.

The repository is public since the public release of 2026-11-25 (owner decision Q1, granted on 2026-11-21: public at the owner's release step), and private vulnerability reporting is turned on, so the channel is open.

## What happens next

A report is answered privately. The fix follows the remediation time frames of the vulnerability policy by the advisory's severity (critical 7 days, high 30, medium 90, low the next release), and the advisory is published with the release that fixes it. The full policy, with the scanning, the allowlist rules and how a fix ships, is `docs/security/vulnerability-policy.md`; the other security records are indexed in `docs/security/README.md`.

## Supported versions

No version has been released. Until the first release, only the default branch is maintained.

## Scope

OpenVerify is self-hosted: the code in this repository, its production images and its Helm chart are in scope. An install's own configuration, infrastructure and data are its operator's (`docs/self-hosting/README.md`). The threat model and the ASVS and MASVS checklists are the project's own assessment, never a certification (`docs/security/threat-model.md`).
