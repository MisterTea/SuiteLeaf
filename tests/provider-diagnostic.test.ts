import { describe, expect, it } from "vitest";
import { providerDiagnostic, providerMetadata, samlMetadata } from "../apps/web/src/admin/provider-diagnostic";

describe("provider diagnostic", () => {
  it("accepts an https issuer and does not repeat the client secret", () => {
    const saved = providerDiagnostic({
      protocol: "oidc",
      issuer: "https://idp.example/realms/garden",
      audience: "suiteleaf",
      clientSecret: "secret-value",
    });
    expect(saved).toEqual({
      ok: true,
      message: "The provider settings can be saved. The client secret is not shown.",
    });
    expect(JSON.stringify(saved)).not.toContain("secret-value");
    const embedded = providerDiagnostic({
      protocol: "saml",
      issuer: "https://user:secret-value@idp.example",
      audience: "suiteleaf",
      clientSecret: "",
    });
    expect(embedded).toEqual({ ok: false, message: "The issuer must be an https address." });
    expect(embedded.message).not.toContain("secret-value");
    const query = providerDiagnostic({
      protocol: "oidc",
      issuer: "https://idp.example/realms/garden?token=secret-value#access_token=secret-value",
      audience: "suiteleaf",
      clientSecret: "",
    });
    expect(query).toEqual({
      ok: false,
      message: "The issuer address cannot include a credential.",
    });
    expect(JSON.stringify(query)).not.toContain("secret-value");
    expect(JSON.stringify(query)).not.toContain("idp.example");
    const path = providerDiagnostic({
      protocol: "oidc",
      issuer: "https://idp.example/secret-value",
      audience: "suiteleaf",
      clientSecret: "",
    });
    expect(path).toEqual({
      ok: false,
      message: "The issuer address cannot include a credential.",
    });
    expect(path.message).not.toContain("secret-value");
    const named = providerDiagnostic({
      protocol: "oidc",
      issuer: "secret-value",
      audience: "suiteleaf",
      clientSecret: "secret-value",
    });
    expect(named.message).toBe("The issuer must be an https address.");
    expect(named.message).not.toContain("secret-value");
    expect(
      providerDiagnostic({
        protocol: "oidc",
        issuer: "https://idp.example",
        audience: "  ",
        clientSecret: "",
      }).message,
    ).toBe("Name the audience.");
  });

  it("accepts matching OpenID Connect metadata and does not repeat a credential", () => {
    const metadata = JSON.stringify({
      issuer: "https://idp.example/realms/garden",
      authorization_endpoint: "https://idp.example/auth",
      token_endpoint: "https://idp.example/token",
      jwks_uri: "https://idp.example/jwks",
      client_secret: "secret-value",
    });
    const saved = providerMetadata("https://idp.example/realms/garden", metadata);
    expect(saved).toEqual({
      ok: true,
      message: "The provider settings can be saved. The client secret is not shown.",
    });
    expect(JSON.stringify(saved)).not.toContain("secret-value");
    const http = providerMetadata(
      "https://idp.example/realms/garden",
      JSON.stringify({
        issuer: "https://idp.example/realms/garden",
        authorization_endpoint: "https://idp.example/auth",
        token_endpoint: "https://idp.example/token",
        jwks_uri: "http://secret-value.example/jwks",
      }),
    );
    expect(http).toEqual({ ok: false, message: "The provider metadata must use https." });
    expect(http.message).not.toContain("secret-value");
    const leaked = providerMetadata(
      "https://idp.example/realms/garden",
      JSON.stringify({
        issuer: "https://idp.example/realms/garden",
        authorization_endpoint: "https://idp.example/auth",
        token_endpoint: "https://idp.example/token",
        jwks_uri: "https://idp.example/jwks?token=secret-value",
      }),
    );
    expect(leaked).toEqual({
      ok: false,
      message: "The provider metadata cannot include a credential.",
    });
    expect(leaked.message).not.toContain("secret-value");
    const other = providerMetadata("https://idp.example/realms/garden", "secret-value");
    expect(other).toEqual({ ok: false, message: "The provider metadata cannot be read." });
    expect(other.message).not.toContain("secret-value");
    expect(
      providerMetadata(
        "https://idp.example/realms/garden",
        JSON.stringify({
          issuer: "https://other.example/realms/garden",
          authorization_endpoint: "https://idp.example/auth",
          token_endpoint: "https://idp.example/token",
          jwks_uri: "https://idp.example/jwks",
        }),
      ).message,
    ).toBe("The metadata issuer does not match.");
  });

  it("accepts matching SAML metadata and does not repeat a credential", () => {
    const document = `<EntityDescriptor entityID="https://idp.example/realms/garden"><SingleSignOnService Location="https://idp.example/saml" /></EntityDescriptor>`;
    const saved = samlMetadata("https://idp.example/realms/garden", document);
    expect(saved).toEqual({
      ok: true,
      message: "The provider settings can be saved. The client secret is not shown.",
    });
    const http = samlMetadata(
      "https://idp.example/realms/garden",
      `<EntityDescriptor entityID="https://idp.example/realms/garden"><SingleSignOnService Location="http://secret-value.example/saml" /></EntityDescriptor>`,
    );
    expect(http).toEqual({ ok: false, message: "The provider metadata must use https." });
    expect(http.message).not.toContain("secret-value");
    const leaked = samlMetadata(
      "https://idp.example/realms/garden",
      `<EntityDescriptor entityID="https://idp.example/realms/garden"><SingleSignOnService Location="https://idp.example/saml?token=secret-value" /></EntityDescriptor>`,
    );
    expect(leaked).toEqual({
      ok: false,
      message: "The provider metadata cannot include a credential.",
    });
    expect(leaked.message).not.toContain("secret-value");
    const other = samlMetadata("https://idp.example/realms/garden", "secret-value");
    expect(other).toEqual({ ok: false, message: "The provider metadata cannot be read." });
    expect(other.message).not.toContain("secret-value");
  });
});
