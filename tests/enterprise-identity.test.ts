import { describe, expect, it } from "vitest";
import { providerDiagnostic, providerMetadata } from "../apps/web/src/admin/provider-diagnostic";
import {
  decideClientSession,
  sessionActivityNote,
} from "../apps/web/src/session-policy";
import { envFromProcess, JWT_AUDIENCE, JWT_ISSUER, plugins } from "../services/auth/src/options";

describe("WP-008 Enterprise sign-in, MFA, and session policy", () => {
  it("validates enterprise IdP configuration without leaking secrets or accepting insecure endpoints", () => {
    // 1. Valid OIDC setup
    const validOidc = providerDiagnostic({
      protocol: "oidc",
      issuer: "https://idp.corp.example/realms/enterprise",
      audience: "suiteleaf-app",
      clientSecret: "super-secret-client-credential-12345",
    });
    expect(validOidc.ok).toBe(true);
    expect(validOidc.message).toContain("provider settings can be saved");
    expect(validOidc.message).not.toContain("super-secret");

    // 2. Reject non-https / credentialed issuer
    const insecure = providerDiagnostic({
      protocol: "oidc",
      issuer: "http://idp.corp.example",
      audience: "suiteleaf-app",
      clientSecret: "secret",
    });
    expect(insecure.ok).toBe(false);
    expect(insecure.message).toContain("must be an https address");

    // 3. Reject credential embedded in URL
    const credentialed = providerDiagnostic({
      protocol: "saml",
      issuer: "https://admin:token123@idp.corp.example",
      audience: "suiteleaf-app",
      clientSecret: "",
    });
    expect(credentialed.ok).toBe(false);
    expect(credentialed.message).not.toContain("token123");

    // 4. Validate OIDC discovery document matching issuer
    const validOidcMetadata = JSON.stringify({
      issuer: "https://idp.corp.example/realms/enterprise",
      authorization_endpoint: "https://idp.corp.example/realms/enterprise/protocol/openid-connect/auth",
      token_endpoint: "https://idp.corp.example/realms/enterprise/protocol/openid-connect/token",
      jwks_uri: "https://idp.corp.example/realms/enterprise/protocol/openid-connect/certs",
    });
    const metaResult = providerMetadata("https://idp.corp.example/realms/enterprise", validOidcMetadata);
    expect(metaResult.ok).toBe(true);
    expect(metaResult.message).toContain("provider settings can be saved");

    // 5. Insecure metadata location rejected
    const insecureMetadata = JSON.stringify({
      issuer: "https://idp.corp.example/realms/enterprise",
      authorization_endpoint: "http://insecure.example/auth",
      token_endpoint: "https://idp.corp.example/token",
      jwks_uri: "https://idp.corp.example/jwks",
    });
    const insecureMetaResult = providerMetadata("https://idp.corp.example/realms/enterprise", insecureMetadata);
    expect(insecureMetaResult.ok).toBe(false);
    expect(insecureMetaResult.message).toContain("must use https");
  });

  it("enforces session lifecycle, idle timeouts, forced reauthentication, and device status", () => {
    const baseNow = new Date("2026-11-04T12:00:00.000Z").getTime();
    const nowIso = new Date(baseNow).toISOString();
    const freshIso = new Date(baseNow - 60_000).toISOString();
    const staleIso = new Date(baseNow - 7_200_000).toISOString(); // 2 hours ago
    const futureExpiryIso = new Date(baseNow + 86_400_000).toISOString();

    // Active session within idle window
    expect(
      decideClientSession({
        expiresAt: futureExpiryIso,
        updatedAt: freshIso,
        now: nowIso,
        idleSecs: 1800, // 30 min idle limit
      }),
    ).toBe("accept");

    // Idle session past inactivity limit
    expect(
      decideClientSession({
        expiresAt: futureExpiryIso,
        updatedAt: staleIso,
        now: nowIso,
        idleSecs: 1800,
      }),
    ).toBe("idle");

    // Expired session past hard expiration
    expect(
      decideClientSession({
        expiresAt: new Date(baseNow - 1000).toISOString(),
        updatedAt: freshIso,
        now: nowIso,
      }),
    ).toBe("expired");

    // Forced reauthentication flag (e.g. following credential change or admin action)
    expect(
      decideClientSession({
        expiresAt: futureExpiryIso,
        updatedAt: freshIso,
        now: nowIso,
        reauth: true,
      }),
    ).toBe("reauth");

    expect(
      sessionActivityNote({
        expiresAt: futureExpiryIso,
        updatedAt: freshIso,
        now: nowIso,
        reauth: true,
      }),
    ).toBe("This device must sign in again.");
  });

  it("shares origin trust and unified session policy across desktop and web clients", () => {
    const env = envFromProcess({
      SUITELEAF_AUTH_SECRET: "s".repeat(32),
      SUITELEAF_PUBLIC_URL: "https://suiteleaf.corp.example",
      SUITELEAF_TRUSTED_ORIGINS: "suiteleaf://app, https://suiteleaf.corp.example",
    });

    // Both desktop scheme (suiteleaf://app) and web host are trusted
    expect(env.trustedOrigins).toContain("suiteleaf://app");
    expect(env.trustedOrigins).toContain("https://suiteleaf.corp.example");

    // Cluster-wide constants match
    expect(JWT_ISSUER).toBe("suiteleaf");
    expect(JWT_AUDIENCE).toBe("suiteleaf");

    const pluginList = plugins(env).map((p) => p.id);
    expect(pluginList).toContain("admin");
    expect(pluginList).toContain("organization");
    expect(pluginList).toContain("jwt");
    expect(pluginList).toContain("bearer");
    expect(pluginList).toContain("username");
  });

  it("preserves account-free single-node local use", () => {
    // When no auth server or session is passed, client session accepts local usage
    const localSession = decideClientSession({});
    expect(localSession).toBe("accept");

    // Unmanaged local operations need no credentials
    const localNote = sessionActivityNote({});
    expect(localNote).toBe("No idle limit is set.");
  });
});
