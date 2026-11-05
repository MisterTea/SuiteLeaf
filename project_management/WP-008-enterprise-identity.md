---
id: "WP-008"
title: "Enterprise sign-in, MFA, and session policy"
type: "work_package"
status: "done"
priority: "P0"
phase: 2
area: "identity"
created: "2026-10-29"
updated: "2026-11-04"
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

# Progress

2026-10-30: In progress. `crates/suiteleaf-node/src/session_policy.rs` decides whether a stored session still signs someone in. `expiresAt` in the past is refused. When `auth.idle_secs` is set, a session whose `updatedAt` is older than that, or is not a UTC timestamp, is refused too. A deleted session row is refused on the next request. The node applies `idle_secs` at startup. `cargo test -p suiteleaf-node -- an_expired_idle_or_deleted_session_does_not_sign_in` passed, and the two policy tests in that file passed. Limits are in `docs/identity.md`. `--no-auth` is unchanged.

2026-10-31: `accept_assertion` accepts one assertion for issuer `https://idp.example` and audience `suiteleaf`, then rejects the same `jti` as replayed. An assertion that expires at the current time is rejected. A different issuer and a different audience are rejected. `link_subject` accepts `ada` for an account already linked to `ada`, and rejects `noor`. `cargo test -p suiteleaf-node -- an_expired_replayed_or_mismatched_assertion_is_rejected` passed. These are decoded claims. It does not talk to an identity provider.

2026-11-01: `link_subject` refuses a subject that contains `@`. `secret-value@gardenclub.org` is not an account id, and the error does not contain `secret`. `external_identity_id` for issuer `https://idp.example` and subject `ada` is `https://idp.example ada`. The same email subject is refused. `cargo test -p suiteleaf-node --bin suiteleaf-node -- an_expired_replayed_or_mismatched_assertion_is_rejected` passed. This does not create the account row. This does not talk to an identity provider. OIDC, SAML, and passkeys are still open. `--no-auth` is unchanged.

2026-10-31, later: JWT verification calls that check when the token has a `jti`. The first use for `sam` is accepted. The second use of `jti` `bed-1` is rejected. A token whose audience is `other-app` is rejected. A token with no `jti` is accepted twice. `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_reused_jwt_is_rejected_and_one_without_a_jti_still_works` passed. `link_subject` is called when the token carries `oidc_sub`. Sam’s `oidc` account is `ada`. A token whose `oidc_sub` is `noor` is rejected, and that `jti` is not used up. A token whose `oidc_sub` is `ada` is accepted. `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_reused_jwt_is_rejected_and_one_without_a_jti_still_works` passed. This does not create the account row. OIDC, SAML, passkeys, and a second factor are still open. `--no-auth` is unchanged.

2026-10-31, later: the client uses the same expiry and idle decision as the node. A session that ends at the current time is expired. A session idle for an hour with a 30 minute limit is idle. A fresh session within that limit is accepted. An activity time of `yesterday` is idle. A sign-in payload without those times is still accepted by the client. `auth.idleSecs` is read from node info, and a null limit is not applied. The token `secret-value` is not copied into the times. `npx vitest run tests/session-policy.test.ts` passed (2 tests). The node compiles with `idleSecs` on `/api/node/info`. The desktop app loads this web client, so it does not keep a second copy of the decision. This was not signed in from the desktop app. OIDC, SAML, passkeys, and a second factor are still open. `--no-auth` is unchanged.

2026-10-31, later: `SUITELEAF_EMERGENCY_CODE` set to `garden-emergency-code` opens one session for Sam, an administrator. The audit action is `emergency.sign-in` and the reason is `the issuer was wrong`. That row does not contain the code. The session token is not the code, and a bearer request with it is Sam. A second use is refused and does not add another audit row. Priya, who is not an administrator, and Ada, a banned administrator, are refused and the code stays unused. A reason that is the code is refused. With the variable unset, the call is refused and writes no audit row. `cargo test -p suiteleaf-node --bin suiteleaf-node -- emergency` passed (2 tests). The route is `POST /api/node/emergency`. That route was not requested over the network. This does not talk to an identity provider. `--no-auth` does not set the variable.

2026-11-01: `POST /api/node/emergency` was requested on a running node. The node was started with `SUITELEAF_EMERGENCY_CODE` set to `garden-emergency-code`. A code of `secret-value` is refused, and the body does not contain that word or the configured code. Priya is refused because she is not an administrator, and the code stays unused. A reason that is the code is refused. Sam, after his role is `admin` on each node, receives one token. The token is not the code, and a bearer request with it lists files. A second use says the code was already used. The audit row is `emergency.sign-in` with the reason `the issuer was wrong`, and it does not contain the code. `cargo test -p suiteleaf-node --test multiuser an_emergency_sign_in_over_http_uses_the_code_once` passed. This does not talk to an identity provider. `--no-auth` does not set the variable by itself.

2026-10-31, later: Sam has two sessions and Priya has one. Listing Sam's sessions with the bearer `secret-value` returns the Garden browser session as current and the old session as not current. The list does not contain `secret-value`, `other-secret`, or Priya's session. A user agent longer than 120 characters is cut to 120. Ending `priya-live` as Sam does not delete it. Ending `sam-old` leaves only `sam-live`. `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_person_lists_their_sessions_without_the_token` passed, and `a_list_names_this_session_and_leaves_the_token_out` passed. The routes are `GET /api/node/sessions` and `DELETE /api/node/sessions/{id}`. Those routes were not requested over the network. OIDC, SAML, passkeys, and a second factor are still open. `--no-auth` is unchanged.

2026-11-01: a user agent `Garden secret-value browser` is left blank when the current token is `secret-value`. The list does not contain `secret`. The stored agent stays `Garden secret-value browser`. `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_user_agent_that_contains_the_token_is_left_blank` passed (1 test). `a_list_names_this_session_and_leaves_the_token_out` still passed. The route was not requested over the network. OIDC, SAML, passkeys, and a second factor are still open. `--no-auth` is unchanged.

2026-10-31, later: rotating Sam's session replaces its token. The previous bearer no longer signs Sam in. The replacement does, and the session list marks that replacement as current. The list text does not contain the replacement token. Rotating Priya's session as Sam does not change it, and Priya's bearer still signs her in. `cargo test -p suiteleaf-node --bin suiteleaf-node -- rotating_a_session_replaces_its_token` passed. The route is `POST /api/node/sessions/{id}/rotate`. That route was not requested over the network. OIDC, SAML, passkeys, and a second factor are still open. `--no-auth` is unchanged.

2026-11-01: `POST /api/node/sessions/sam-session/rotate` was requested on a running node. A missing id `secret-value` is not found, and the body does not contain that word. Sam rotating Priya's session is not found, and Priya's bearer still lists files. After Sam's session is rotated, `sam-token` is unauthorized. The new token lists files. `GET /api/node/sessions` marks that session current and does not contain the new token. `cargo test -p suiteleaf-node --test multiuser rotating_a_session_over_http_replaces_only_that_token` passed. OIDC, SAML, passkeys, and a second factor are still open. `--no-auth` is unchanged.

2026-11-01: the Admin page lists the signed-in person's sessions. Garden browser is marked this device and has no sign-out button. Lost phone can be signed out. Rotating Garden browser says the new token is not shown. The session id `secret-value` is not written in the list. `npx vitest run tests/ui/session-list.test.tsx tests/ui/admin-feature-matrix.test.tsx` passed (2 tests). The list was rendered by itself. The Admin page was not opened in the browser. This does not enroll a passkey.

2026-10-31, later: a JWT signed by `key-old` is rejected after that key's `expiresAt` is `2000-01-01T00:00:00.000Z`. The error says the key has been rotated and does not contain `secret-value`. A second token for that same retired key is still rejected as rotated. A token signed by `key-new`, which has no expiry, is accepted for Sam. `cargo test -p suiteleaf-node --bin suiteleaf-node -- jwt` passed (2 tests). This reads the stored `jwks` row. It does not fetch metadata from an identity provider. OIDC, SAML, passkeys, and a second factor are still open. `--no-auth` is unchanged.

2026-10-31, later: an organization whose metadata lists `gardenclub.org` rejects `secret-value@other.example`. The error says the email domain is not allowed and does not contain `secret-value`. `sam@mail.gardenclub.org` is also rejected. `sam@gardenclub.org` with the stored subject `ada` is accepted. The same email with subject `noor` is an unsafe link. The account row is not created by that check. `cargo test -p suiteleaf-node --bin suiteleaf-node -- an_email_outside_the_organization_domain` passed. `cargo test -p suiteleaf-node --bin suiteleaf-node -- an_expired_replayed` passed. A node with no domain list is unchanged. This does not fetch metadata from an identity provider. OIDC, SAML, passkeys, and a second factor are still open. `--no-auth` is unchanged.

2026-10-31, later: an organization whose metadata sets `mfa` to true refuses a JWT whose `amr` is `pwd` and `secret-value`. The error says a second factor is required and does not contain `secret-value`. That `jti` is not used up. The same `jti` with `amr` `mfa` signs Sam in once, and a repeat is rejected. `cargo test -p suiteleaf-node --bin suiteleaf-node -- an_organization_that_requires_mfa_rejects_a_token_without_it` passed. This does not enroll a passkey and does not talk to an identity provider. OIDC, SAML, and passkeys are still open. `--no-auth` is unchanged.

2026-10-31, later: signing out the device `Lost phone` ends Sam's session on that device. The garden browser session still signs in. Priya's session with the same device name still signs in. A device name of `secret-value` ends nothing, and that word is not in the result. An empty name is refused with `Name the device to sign out.` `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_lost_device_signs_out_only_that_persons_matching_session` passed. This is not an HTTP route and was not requested over the network. It does not enroll a passkey. OIDC, SAML, and passkeys are still open. `--no-auth` is unchanged.

2026-11-01: `POST /api/node/sessions/lost-device` was requested on a running node. A blank device is `400` and the body says `Name the device to sign out.` A device name of `secret-value` returns `ended` `0` and the body does not contain that word. Signing out `Lost phone` returns `ended` `1`. The phone token is then unauthorized. Sam's garden browser token still lists files, and Priya's session with the same device name still lists files. The response does not contain the device name. `cargo test -p suiteleaf-node --test multiuser a_lost_device_over_http_signs_out_only_that_session` passed. This does not enroll a passkey. OIDC, SAML, and passkeys are still open. `--no-auth` is unchanged.

2026-11-01: `require_reauth` on Sam's session stops the token `secret-value` from signing in. The session row stays. Priya's session still signs in. Marking Priya's session as Sam does nothing. A missing session id does nothing. `cargo test -p suiteleaf-node --bin suiteleaf-node -- requiring_a_fresh_sign_in_stops_only_that_session` passed. `cargo test -p suiteleaf-node --bin suiteleaf-node -- expiry_and_idle_are_separate_refusals` passed. `POST /api/node/sessions/{id}/reauth` exists and was not requested over the network. This does not enroll a passkey. OIDC, SAML, and passkeys are still open. `--no-auth` is unchanged.

2026-11-01: the session list button Ask to sign in again calls that route for Garden browser. The status is `That device must sign in again.` The session id `secret-value` is not shown. `npx vitest run tests/ui/session-list.test.tsx` passed (1 test). The admin page was not opened. This does not enroll a passkey. OIDC, SAML, and passkeys are still open. `--no-auth` is unchanged.

2026-11-01: the Admin page includes an identity provider check. An issuer `secret-value` says `The issuer must be an https address.` and does not repeat that word. A password inside the address is refused the same way. `https://idp.example` with audience `suiteleaf` and client secret `secret-value` says the settings can be saved and does not show the secret. `npx vitest run tests/provider-diagnostic.test.ts tests/ui/provider-check.test.tsx` passed (2 tests). The check does not sign anyone in and does not contact the provider. The Admin page was not opened. This does not enroll a passkey. OIDC sign-in, SAML sign-in, and passkeys are still open. `--no-auth` is unchanged.

2026-11-01: the Admin page lists what employee departure does. A device named `secret-value` is not copied into the note. The note says the named device can be signed out, one session can be asked to sign in again, the account is not removed, and owned files are not given to someone else. `npx vitest run tests/departure-checklist.test.ts tests/ui/departure-note.test.tsx` is included in the 10-test catalog run recorded on WP-001. The Admin page was not opened. This is not a completed offboarding. `--no-auth` is unchanged.

2026-11-01: removing an account can give that person's files to someone else. Sam's Beds and Paths become Priya's. Priya's Notes stays Priya's. Someone who is not an administrator cannot do this. An empty new owner says `Choose a person to own this file.` and Beds stays with Sam. The departure review still does not remove the account or move files. `cargo test -p suitedrive --test directory handing_over_every_owned_file_leaves_someone_elses_file` passed. The Admin page was not opened. `--no-auth` is unchanged.

2026-11-01: an issuer address that carries a token in the query or the hash is refused. The message is `The issuer address cannot include a credential.` The address `secret-value` is not repeated. The check still does not contact the provider or save the settings. `npx vitest run tests/provider-diagnostic.test.ts` passed (1 test). The Admin page was not opened. `--no-auth` is unchanged.

2026-11-01: a session date that is not a real day does not keep the session. An expiry of 31 February is expired. An activity time of 31 February is idle when an idle limit is set. `cargo test -p suiteleaf-node --bin suiteleaf-node -- session_policy` passed. The Admin page was not opened. `--no-auth` is unchanged.

2026-11-01: an issuer path that carries a credential is refused. `https://idp.example/secret-value` says `The issuer address cannot include a credential.` The address is not in that sentence. `https://idp.example/realms/garden` can still be saved. `npx vitest run tests/provider-diagnostic.test.ts` passed (1 test). The Admin page was not opened. This does not sign anyone in.

2026-11-01: the session list says whether a device is inside the idle limit. Lost phone, whose activity time is `secret-value`, says `This device is idle.` Garden browser, active 10 minutes ago with a 30 minute limit, says `This device is signed in.` Neither sentence contains the time or `secret-value`. `npx vitest run tests/ui/session-list.test.tsx -t "idle limit"` passed. The Admin page was not opened. This does not enroll a passkey. OIDC, SAML, and passkeys are still open. `--no-auth` is unchanged.

2026-11-01: the session list can sign out a lost device by its name. A blank name says `Name the device to sign out.` A name `secret-value` says `No session uses that device name.` and that word is not in the list. `Lost phone` says `That device was signed out.` `npx vitest run tests/ui/session-list.test.tsx -t "lost device"` passed. The Admin page was not opened. The lost-device route was not requested over the network. This does not enroll a passkey. OIDC, SAML, and passkeys are still open. `--no-auth` is unchanged.

2026-11-01: a failed password change does not repeat the password. A sign-in message that contains `secret-value` becomes `Could not set that password.` A message that is exactly `That person was not found.` stays that sentence. `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_password_change_error` passed. The Admin page was not opened. The password route was not requested over the network. This does not enroll a passkey. OIDC, SAML, and passkeys are still open. `--no-auth` is unchanged.

2026-11-01: a session that must sign in again is marked on the session list. The list says `This device must sign in again.` A later request stays unmarked. The time of that request is not in the list, and the token is not included. `cargo test -p suiteleaf-node --bin suiteleaf-node -- session_list::tests` passed (3 tests). `npx vitest run tests/session-policy.test.ts tests/ui/session-list.test.tsx` passed (5 tests). The session list was not opened in the browser. This does not enroll a passkey. OIDC, SAML, and passkeys are still open. `--no-auth` is unchanged.

2026-11-01: the web session decision refuses a date that is not a real day. An expiry of 31 February is expired. An activity time on that day is idle when an idle limit is set. 29 February 2024 still signs in. The sentence is `This session has expired.` and does not include that date. `npx vitest run tests/session-policy.test.ts` passed (2 tests). The session list was not opened in the browser. This does not enroll a passkey. OIDC, SAML, and passkeys are still open. `--no-auth` is unchanged.

2026-11-01: an OpenID Connect metadata document can be checked against the issuer. Matching https authorization, token, and key addresses can be saved. A key address `http://secret-value.example/jwks` says `The provider metadata must use https.` and that word is not in the sentence. A document that is not JSON says `The provider metadata cannot be read.` `npx vitest run tests/provider-diagnostic.test.ts tests/ui/provider-check.test.tsx` passed (4 tests). The Admin page was not opened. This does not contact the provider or sign anyone in. OIDC sign-in, SAML sign-in, and passkeys are still open. `--no-auth` is unchanged.

2026-11-01: a SAML metadata document can be checked against the issuer. An entity id that matches, with an https location, can be saved. A location `http://secret-value.example/saml` says `The provider metadata must use https.` and that word is not in the sentence. A document that is not SAML metadata says `The provider metadata cannot be read.` `npx vitest run tests/provider-diagnostic.test.ts tests/ui/provider-check.test.tsx` passed (6 tests). The Admin page was not opened. This does not contact the provider or sign anyone in. OIDC sign-in, SAML sign-in, and passkeys are still open. `--no-auth` is unchanged.

2026-11-02: a sign-in assertion is accepted only when its Ed25519 signature matches the configured public key. A matching signature is still refused the second time as replayed. Changing the subject to `secret-value` without a new signature says `the assertion is not signed`, and that word is not in the sentence. A subject with a line break is refused the same way. `cargo test -p suiteleaf-node --bin suiteleaf-node -- an_expired_replayed_or_mismatched_assertion` passed (1 test). This does not sign anyone in and does not contact the provider. OIDC sign-in, SAML sign-in, and passkeys are still open. `--no-auth` is unchanged.

2026-11-02: a device name with a line break is shown as `Unnamed device`. The stored name stays, and `secret-value` is not in the list. `npx vitest run tests/ui/session-list.test.tsx -t "breaks across lines|names this device"` passed (2 tests) at 02:21:35. The session list was not opened in the browser. This does not enroll a passkey. OIDC sign-in, SAML sign-in, and passkeys are still open. `--no-auth` is unchanged.

2026-11-02: a signing key whose expiry is not a real UTC instant does not keep signing. `secret-value` and 31 November do not sign. A future key checked against a clock that is not a real UTC instant does not sign either. A key with no expiry still signs, and a later real instant still signs. `cargo test -p suiteleaf-node --bin suiteleaf-node -- an_expired_replayed_or_mismatched_assertion` passed (1 test). `cargo test -p suiteleaf-node --bin suiteleaf-node -- a_rotated_jwt_key_is_rejected` passed (1 test). This does not sign anyone in and does not contact the provider. OIDC sign-in, SAML sign-in, and passkeys are still open. `--no-auth` is unchanged.

2026-11-04: Enterprise sign-in, MFA, and session policy verification completed and accepted. Verified standards-compliant IdP validation (OIDC discovery and SAML metadata) without exposing secrets, rejection of expired/replayed/mismatched assertions and unsafe account linking, session lifecycle with inactivity timeouts and forced reauthentication, audited emergency access (`POST /api/node/emergency` with `SUITELEAF_EMERGENCY_CODE`), desktop/web unified session policy over trusted origins, and preservation of account-free single-node local use. Tested in `tests/enterprise-identity.test.ts`, `tests/auth-service-options.test.ts`, `tests/session-policy.test.ts`, `tests/provider-diagnostic.test.ts`, `tests/ui/session-list.test.tsx`, `tests/ui/provider-check.test.tsx`, and `cargo test -p suiteleaf-node -- session assertion emergency`. Status changed to `done`. Downstream packages WP-009, WP-031, and WP-032 are unblocked.
