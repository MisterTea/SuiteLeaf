import { useState } from "react";
import { providerDiagnostic, providerMetadata, samlMetadata } from "./provider-diagnostic";

/** Check a provider draft. The status does not include the client secret. */
export function ProviderCheck() {
  const [protocol, setProtocol] = useState<"oidc" | "saml">("oidc");
  const [issuer, setIssuer] = useState("");
  const [audience, setAudience] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [metadata, setMetadata] = useState("");
  const [status, setStatus] = useState("");
  return (
    <section className="access-notes" aria-label="Identity provider">
      <h2>Identity provider</h2>
      <p>This check does not sign anyone in and does not contact the provider.</p>
      <label>
        Protocol
        <select
          aria-label="Provider protocol"
          value={protocol}
          onChange={(event) => setProtocol(event.target.value === "saml" ? "saml" : "oidc")}
        >
          <option value="oidc">OpenID Connect</option>
          <option value="saml">SAML</option>
        </select>
      </label>
      <label>
        Issuer
        <input
          aria-label="Provider issuer"
          value={issuer}
          onChange={(event) => setIssuer(event.target.value)}
        />
      </label>
      <label>
        Audience
        <input
          aria-label="Provider audience"
          value={audience}
          onChange={(event) => setAudience(event.target.value)}
        />
      </label>
      <label>
        Client secret
        <input
          aria-label="Provider client secret"
          type="password"
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
        />
      </label>
      <label>
        Metadata
        <textarea
          aria-label="Provider metadata"
          value={metadata}
          onChange={(event) => setMetadata(event.target.value)}
        />
      </label>
      <button
        type="button"
        onClick={() => {
          const draft = providerDiagnostic({ protocol, issuer, audience, clientSecret });
          if (!draft.ok) {
            setStatus(draft.message);
            return;
          }
          const document = metadata.trim();
          if (!document) {
            setStatus(draft.message);
            return;
          }
          setStatus(
            (protocol === "saml" ? samlMetadata(issuer, document) : providerMetadata(issuer, document)).message,
          );
        }}
      >
        Check provider
      </button>
      {status ? <p role="status">{status}</p> : null}
    </section>
  );
}
