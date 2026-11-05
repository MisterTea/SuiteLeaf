# SuiteLeaf Data Governance, Encryption & Residency Architecture

This document defines the cryptographic trust boundaries, data residency placement rules, and administrative guarantees of SuiteLeaf deployments.

---

## 1. Truthful Trust Boundaries & Operator Access

> [!IMPORTANT]
> **Privileged Operator Disclosure:**
> SuiteLeaf uses encryption-at-rest for databases (SuiteDB) and content blobs (SuiteDrive). However, **encryption at rest does not exclude privileged host operators, root administrators, or node infrastructure owners** who hold machine-level access to memory or local environment keys. SuiteLeaf does not claim zero-knowledge end-to-end client encryption (E2EE) for shared collaborative workspaces.

### Trust Boundaries:
1. **Client / Browser / Desktop Application:**
   - Communicates with cluster nodes over TLS 1.3.
   - Session tokens (OIDC bearer tokens) are stored in secure browser session storage or desktop keychain.
2. **Cluster Node Hosts:**
   - Execute the `suiteleaf-node` server daemon, manage replication, and handle local blobs.
   - Each node holds a local identity seal key (`keys.rs`).
3. **Database & Blob Storage:**
   - SuiteDB stores operation logs and metadata tables.
   - Blobs are content-addressed by SHA-256 hashes (`crates/suitedrive/src/blobs.rs`).

---

## 2. Legal Holds vs. Account Offboarding Precedence

SuiteLeaf enforces strict legal precedence:
- **Rule 1: Legal Holds Override All Dispositions.**
  If an employee is offboarded, deleted via SCIM, or voluntarily purges their files, files covered by an active `LegalHold` (by custodian ID, file ID, or query) **cannot be permanently deleted**.
- **Rule 2: Fail Closed on Deletion.**
  If a deletion request encounters any active legal hold, the API fails closed with status `LEGAL_HOLD_PREVENTS_DELETION`. The file contents and historical version blobs remain anchored in storage.
- **Rule 3: Custodian Preservation.**
  When an account is removed, ownership of held files is reassigned to the organization legal/compliance administrator rather than discarded.

---

## 3. Data Residency & Node Placement Rules

In standard deployments, SuiteDB replicates across all participating cluster peers. For organizations with regional or sovereign residency requirements:

1. **Explicit Placement Tags:**
   - Nodes declare geographic tags (e.g. `region: eu-west-1`, `sovereignty: de`).
   - Workspaces and tenants declare residency policies (e.g. `residency: "eu-only"`).
2. **Targeted Replication Routing:**
   - Nodes outside the declared residency zone are excluded from the peer replication pool for that tenant's database rows and content blobs.
   - Discovery search indexes for European data are hosted exclusively on European nodes.
3. **Audit Trail Immutability:**
   - All access, sharing, export, and governance events are written to an append-only, SHA-256 hash-chained audit log (`AppendOnlyAuditLogger`).
   - Audit exports can be cryptographically verified off-node by compliance auditors.

---

## 4. Sensitive Data Classification & Enforcement

SuiteLeaf provides four standardized classification tiers:
- **Public:** Free sharing, offline use, and export.
- **Internal:** Organization members only; external sharing prohibited.
- **Confidential:** External sharing prohibited; local offline caching prohibited.
- **Restricted:** External sharing, local exports, offline caching, and third-party AI processing are strictly blocked.

Policy evaluations explain the restriction without leaking the detected secret string to unauthorized users.
Expiring administrative overrides are logged to the tamper-evident audit log with reason and expiration date.
