# Security policy

## Reporting a vulnerability

Report vulnerabilities privately. Use GitHub's private vulnerability reporting at https://github.com/hraness/dawg/security/advisories/new, or email hraness@pm.me. Please do not open a public issue for a security problem.

Include the affected version, the steps to reproduce, and the impact you observed. You should get an acknowledgement within a few days. Fixes ship in the next release, and reporters are credited in the advisory unless they ask otherwise.

## Scope

In scope are the `@hraness/dawg` package, its session files and agent gateway, the installer served at https://dawg.sh/install, and the dawg.sh website. Releases ship a SHA256SUMS file and a build provenance attestation, and the installer checks the tarball against it before installing.
