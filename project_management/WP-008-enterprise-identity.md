---
id: "WP-008"
title: "Enterprise sign-in, MFA, and session policy"
type: "work_package"
status: "ready"
priority: "P0"
phase: 2
area: "identity"
created: "2026-10-29"
updated: "2026-10-29"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S01", "S02"]
---

# Enterprise sign-in, MFA, and session policy

## Outcome and rationale

Allow organizations to use their identity provider and enforce sign-in controls without losing SuiteLeaf's independent local mode.

## Existing implementation and starting points

`services/auth/src/options.ts` configures email/password, Google, GitHub, Nextcloud, JWTs, organizations, and administration. It does not currently configure SAML, SCIM, passkeys, or a two-factor plugin. Inspect node token verification and desktop OAuth handoff as well.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Add configurable enterprise OIDC and SAML federation with issuer/audience validation, signed assertion handling, safe account linking, metadata rotation, and domain-claim verification.
- Implement MFA/passkeys and recovery with admin-enforced policy, enrollment, lost-device handling, and audited emergency access.
- Define session lifetime, inactivity, device/session listing, forced reauthentication, token rotation, revocation, and propagation across nodes.
- Add a tested provider setup wizard and diagnostics that never expose secrets. Store configuration/credentials securely and restrict who can change federation.
- Design stable external identity identifiers for WP-009 provisioning; do not use a mutable or unverified email alone as proof of account ownership.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- An organization can configure a standards-compliant test IdP, enforce SSO/MFA, and recover from a broken configuration through an audited emergency path.
- Expired/replayed assertions, wrong audience/issuer, unsafe linking, and revoked sessions are rejected.
- Desktop and web sign-in work with the same organization policy.
- Single-node local use remains account-free.

## Verification

- Use standards fixtures and integration tests for OIDC/SAML validation, key rotation, recovery, and revocation.
- Use Vitest/jsdom for enrollment/configuration flows and Rust tests for node authentication.
- Document dependency licensing and supported protocol profiles; do not assume all IdP extensions work.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Device management and endpoint antivirus are not implemented by adding SSO. Provisioning and employee offboarding are WP-009.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S01`, `S02`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.
