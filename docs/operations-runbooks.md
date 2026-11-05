# SuiteLeaf Operational Runbooks & Support Incident Procedures

This document contains standard operating procedures (SOPs) and runbooks for SuiteLeaf self-hosted cluster operators, site reliability engineers, and administrators.

---

## 1. Authentication Failure & Locked-Out Administrator Recovery

### Symptoms
- Single-Sign-On (OIDC/SAML) provider outage, misconfigured client credentials, or expired certificates.
- Administrators locked out of the `/admin` portal.

### Runbook Procedure: Emergency Sign-In
SuiteLeaf nodes include a dedicated, audited emergency administrative access mechanism:
1. Ensure `SUITELEAF_EMERGENCY_CODE` was established in node environment configurations.
2. Locate the node host terminal with authorized SSH/container access.
3. Post an authenticated emergency sign-in request directly to the local node:
   ```bash
   curl -X POST http://127.0.0.1:8000/api/node/emergency \
     -H "Content-Type: application/json" \
     -d '{
       "userId": "<admin-account-id>",
       "code": "<one-time-emergency-code>",
       "reason": "OIDC provider outage - emergency cluster maintenance"
     }'
   ```
4. **Behavior & Guarantees:**
   - The emergency code is one-time use; upon matching, it is consumed and immediately invalidated.
   - An immutable audit row is written to SuiteDB with timestamp, administrator ID, and the stated reason (the code itself is never logged).
   - The returned temporary session token allows administrative access to restore OIDC settings or reset administrator credentials.

---

## 2. Full Disk & Storage Quota Exhaustion

### Symptoms
- Telemetry alert `ERR_DISK_FULL` (usage > 95%) or user error `ERR_STORAGE_QUOTA_EXCEEDED`.
- Incoming server writes are halted safely before acknowledgment.
- Client documents remain intact locally with `preserveLocalEdits: true`.

### Runbook Procedure:
1. **Immediate Assessment:**
   - Query node health telemetry:
     ```bash
     curl -s http://127.0.0.1:8000/api/node/info
     ```
   - Check local volume disk space:
     ```bash
     df -h $SUITELEAF_DATA_DIR
     ```
2. **Safe Mitigation:**
   - Expand underlying storage volume (e.g. EBS volume resize or ZFS expansion).
   - If expansion is delayed, run blob garbage collection to prune unreferenced historical blobs:
     ```bash
     suitedrive gc --older-than 30d
     ```
   - Once free space exceeds 10% (threshold ratio < 0.90), writes resume automatically; clients will upload pending local edits without data loss.

---

## 3. Missing Blobs & Damaged Index Repair

### Symptoms
- Telemetry alert `ERR_DATA_INTEGRITY`.
- Content hash lookup failures during document open or sync.

### Runbook Procedure:
1. **Isolate and Verify:**
   - Check the damaged document's content hash against blobstore:
     ```bash
     suitedrive verify --content-id <hash>
     ```
2. **Reconciliation from Backup:**
   - Use the backup restore tool (`suitedrive::backup::restore_file`) to restore the specific missing content blob from the latest verified backup archive without rolling back unrelated database rows:
     ```bash
     suitedrive restore-blob --backup-dir $SUITELEAF_BACKUP_DIR --hash <hash>
     ```
3. **Rebuild Damaged Search / Workspace Indexes:**
   - Trigger index rebuild through `WorkspaceSearchIndex.rebuild()` or node CLI:
     ```bash
     suitedrive index rebuild --tenant <tenant-id>
     ```
   - Search index rebuilds execute concurrently without locking active document collaboration.

---

## 4. Stale Backup & Restore Drills

### Symptoms
- Telemetry alert `ERR_STALE_BACKUP` (last backup > 24 hours ago or restore drill not tested).

### Runbook Procedure:
1. **Trigger Manual Backup:**
   ```bash
   suitedrive backup create --out $SUITELEAF_BACKUP_DIR
   ```
2. **Verify Backup Integrity & Restore Drill:**
   - SuiteLeaf requires periodic automated restore drills to test cryptographic hashes and database consistency:
     ```bash
     suitedrive backup verify --dir $SUITELEAF_BACKUP_DIR
     suitedrive backup drill --dir $SUITELEAF_BACKUP_DIR
     ```
   - Verify `restoreTested: true` in the node's `/api/admin/backup-status` endpoint.

---

## 5. Node Replacement & Rolling Upgrades

### Node Replacement
1. Deploy new node instance with identical cluster join tokens and network peers.
2. The joining node pulls historical operations from existing peers via SuiteDB replication (`sync_ops`).
3. Blob store replication fetches missing content blobs on demand.
4. Verify peer connectivity:
   ```bash
   curl -s http://127.0.0.1:8000/api/node/info | jq .peers
   ```

### Rolling Upgrades
1. Upgrade nodes one by one.
2. SuiteDB protocol is backward compatible within adjacent minor versions.
3. Monitor replication backlog during node restarts: `backlogCount` should drain to 0 within minutes of node restart.

---

## 6. Incident Severity & Support Escalation Process

| Severity | Definition | Initial Response SLA | Escalation Path |
| :--- | :--- | :--- | :--- |
| **Sev-1 (Critical)** | Entire cluster down, data integrity failure, or all users unable to edit/save. | < 15 minutes | Lead SRE + Engineering On-Call |
| **Sev-2 (Major)** | Storage quota exhaustion, replication lag > 30s, or single node offline in cluster. | < 1 hour | Duty SRE |
| **Sev-3 (Minor)** | Single user sync failure, non-blocking feature degradation. | < 8 business hours | Tier 2 Support |
| **Sev-4 (Inquiry)** | Operational questions, non-critical telemetry warnings. | < 24 business hours | Tier 1 Support |

### External Status Page & Privacy-Safe Incident Tracking
- External status updates must be hosted on infrastructure independent of the primary SuiteLeaf deployment (e.g. status.company.com).
- Support tickets collect only `DiagnosticsBundle` JSON payloads:
  - Document contents, cell values, and slide pictures are strictly excluded.
  - Auth tokens, session cookies, and API keys are redacted.
  - Each diagnostic incident records only correlation IDs, software versions, structural statistics, and stable error codes.
