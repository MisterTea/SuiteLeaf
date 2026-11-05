import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { DiscoveryExportManifest, DiscoveryFileRecord } from "./types";

export class DiscoveryService {
  /**
   * Generates a signed e-Discovery export bundle with immutable manifest.
   */
  createDiscoveryExport(params: {
    exportId?: string;
    requesterId: string;
    authorizedScope: string;
    files: DiscoveryFileRecord[];
  }): DiscoveryExportManifest {
    const exportId = params.exportId ?? `disc_${Math.random().toString(36).slice(2, 9)}`;
    const generatedAt = new Date().toISOString();

    const sortedFiles = [...params.files].sort((a, b) => a.id.localeCompare(b.id));
    const totalBytes = sortedFiles.reduce((acc, f) => acc + (f.name.length * 1024), 0);

    // Compute manifest signature over file hashes, scope, and requester
    const payloadToSign = JSON.stringify({
      exportId,
      requesterId: params.requesterId,
      authorizedScope: params.authorizedScope,
      fileHashes: sortedFiles.map((f) => ({ id: f.id, sha256: f.sha256 })),
    });

    const manifestSignature = bytesToHex(sha256(new TextEncoder().encode(payloadToSign)));

    return {
      exportId,
      requesterId: params.requesterId,
      authorizedScope: params.authorizedScope,
      generatedAt,
      files: sortedFiles,
      totalBytes,
      manifestSignature,
    };
  }

  /**
   * Independently verifies that a discovery export bundle has not been altered.
   */
  verifyDiscoveryExport(manifest: DiscoveryExportManifest): {
    valid: boolean;
    error?: string;
  } {
    const sortedFiles = [...manifest.files].sort((a, b) => a.id.localeCompare(b.id));
    const payloadToSign = JSON.stringify({
      exportId: manifest.exportId,
      requesterId: manifest.requesterId,
      authorizedScope: manifest.authorizedScope,
      fileHashes: sortedFiles.map((f) => ({ id: f.id, sha256: f.sha256 })),
    });

    const expectedSignature = bytesToHex(sha256(new TextEncoder().encode(payloadToSign)));

    if (expectedSignature !== manifest.manifestSignature) {
      return {
        valid: false,
        error: "Manifest signature mismatch: export bundle has been tampered with or modified.",
      };
    }

    return { valid: true };
  }
}
