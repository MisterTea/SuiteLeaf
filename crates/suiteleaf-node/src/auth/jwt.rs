//! Bearer JWTs: the signing keys, the organization rules, and one use per `jti`.

use anyhow::{Result, anyhow, bail};
use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use suitedb::Value;

use crate::assertion::{
    Assertion, accept_assertion, email_domain_allowed, key_still_signs, link_subject,
};

use super::{Auth, AuthUser, JWT_AUDIENCE, JWT_ISSUER};

impl Auth {
    pub(super) fn verify_jwt(&self, token: &str) -> Result<AuthUser> {
        let kid = jsonwebtoken::decode_header(token)?
            .kid
            .ok_or_else(|| anyhow!("JWT has no key ID"))?;
        let row = self
            .db
            .get("jwks", &kid)?
            .ok_or_else(|| anyhow!("unknown JWT key {kid}"))?;
        let expires_at = match row.get("expiresAt") {
            Some(Value::Text(value)) => value.clone(),
            _ => String::new(),
        };
        if !key_still_signs(&expires_at, &suitedb::hlc::iso_now()) {
            bail!("JWT key has been rotated");
        }
        let Some(Value::Text(public)) = row.get("publicKey") else {
            bail!("JWT key has no public key")
        };
        let jwk: Jwk = serde_json::from_str(public)?;
        if jwk.kty != "OKP" || jwk.crv.as_deref() != Some("Ed25519") {
            bail!("unsupported JWT key type");
        }
        let key = DecodingKey::from_ed_components(&jwk.x)?;
        let mut validation = Validation::new(Algorithm::EdDSA);
        validation.set_issuer(&[JWT_ISSUER]);
        validation.set_audience(&[JWT_AUDIENCE]);
        let claims = jsonwebtoken::decode::<Claims>(token, &key, &validation)?.claims;
        if claims.banned == Some(true) {
            bail!("user is banned");
        }
        if let Some(incoming) = claims
            .oidc_sub
            .clone()
            .filter(|subject| !subject.is_empty())
        {
            link_subject(self.linked_oidc(&claims.sub)?.as_deref(), &incoming)
                .map_err(anyhow::Error::msg)?;
        }
        let domains = self.allowed_email_domains()?;
        if !domains.is_empty() {
            email_domain_allowed(claims.email.as_deref().unwrap_or(""), &domains)
                .map_err(anyhow::Error::msg)?;
        }
        if self.organization_requires_mfa()? && !assertion_has_mfa(&claims.amr) {
            bail!("This organization requires a second factor.");
        }
        self.remember_jti(&claims)?;
        let mut user = AuthUser {
            id: claims.sub,
            email: claims.email,
            name: claims.name,
            role: claims.role,
        };
        // Role and ban live in the user row. A JWT issued before a change
        // would otherwise keep the old role until it expired.
        if let Some(row) = self.db.get("user", &user.id)? {
            if matches!(row.get("banned"), Some(Value::Integer(n)) if *n != 0) {
                bail!("user is banned");
            }
            if let Some(Value::Text(role)) = row.get("role") {
                user.role = Some(role.clone());
            }
        }
        Ok(user)
    }

    /// True when any organization metadata sets `mfa` to true.
    fn organization_requires_mfa(&self) -> Result<bool> {
        let rows = self.db.query("SELECT metadata FROM organization", &[])?;
        for row in rows {
            let Some(Value::Text(metadata)) = row.get("metadata") else {
                continue;
            };
            let Ok(parsed) = serde_json::from_str::<serde_json::Value>(metadata) else {
                continue;
            };
            if parsed.get("mfa").and_then(|value| value.as_bool()) == Some(true) {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Domains named in any organization's metadata. An empty list is no rule.
    fn allowed_email_domains(&self) -> Result<Vec<String>> {
        let rows = self.db.query("SELECT metadata FROM organization", &[])?;
        let mut domains = Vec::new();
        for row in rows {
            let Some(Value::Text(metadata)) = row.get("metadata") else {
                continue;
            };
            let Ok(parsed) = serde_json::from_str::<serde_json::Value>(metadata) else {
                continue;
            };
            let Some(list) = parsed.get("domains").and_then(|value| value.as_array()) else {
                continue;
            };
            for item in list {
                let Some(domain) = item.as_str().filter(|domain| !domain.is_empty()) else {
                    continue;
                };
                domains.push(domain.to_ascii_lowercase());
            }
        }
        Ok(domains)
    }

    /// The subject already stored for this user at provider `oidc`, if any.
    fn linked_oidc(&self, user_id: &str) -> Result<Option<String>> {
        let rows = self.db.query(
            "SELECT accountId FROM account WHERE userId = ?1 AND providerId = 'oidc'",
            &[Value::Text(user_id.into())],
        )?;
        Ok(rows.into_iter().find_map(|row| match row.get("accountId") {
            Some(Value::Text(id)) if !id.is_empty() => Some(id.clone()),
            _ => None,
        }))
    }

    /// A JWT with a `jti` may be used once. A JWT without one is left as it was.
    fn remember_jti(&self, claims: &Claims) -> Result<()> {
        let Some(jti) = claims.jti.clone().filter(|jti| !jti.is_empty()) else {
            return Ok(());
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| i64::try_from(duration.as_secs()).unwrap_or(i64::MAX))
            .unwrap_or(0);
        let assertion = Assertion {
            issuer: JWT_ISSUER.into(),
            audience: JWT_AUDIENCE.into(),
            expires_at: claims.exp,
            jti,
            subject: claims.sub.clone(),
        };
        let mut seen = self.seen.write().unwrap();
        accept_assertion(&assertion, now, &mut seen, JWT_ISSUER, JWT_AUDIENCE)
            .map_err(anyhow::Error::msg)?;
        Ok(())
    }
}

#[derive(Deserialize)]
struct Jwk {
    kty: String,
    crv: Option<String>,
    x: String,
}

#[derive(Deserialize)]
struct Claims {
    sub: String,
    exp: i64,
    email: Option<String>,
    name: Option<String>,
    role: Option<String>,
    banned: Option<bool>,
    #[serde(default)]
    jti: Option<String>,
    #[serde(default)]
    oidc_sub: Option<String>,
    #[serde(default)]
    amr: Vec<String>,
}

fn assertion_has_mfa(methods: &[String]) -> bool {
    methods.iter().any(|method| method == "mfa")
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::schema::node_schema;
    use suitedb::Db;

    fn ed25519_pkcs8(seed: &[u8; 32]) -> Vec<u8> {
        let mut der = vec![
            0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22,
            0x04, 0x20,
        ];
        der.extend_from_slice(seed);
        der
    }

    #[test]
    fn a_reused_jwt_is_rejected_and_one_without_a_jti_still_works() {
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
        use jsonwebtoken::{EncodingKey, Header};

        let key = suiteleaf_net::identity::ed25519::Keypair::generate();
        let public = URL_SAFE_NO_PAD.encode(key.public().to_bytes());
        let seed: [u8; 32] = key.to_bytes()[..32].try_into().unwrap();
        let encoding = EncodingKey::from_ed_der(&ed25519_pkcs8(&seed));
        let db = Arc::new(
            Db::open_in_memory(
                suiteleaf_net::identity::ed25519::Keypair::generate(),
                node_schema(None).unwrap(),
            )
            .unwrap(),
        );
        db.transact(|tx| {
            tx.upsert(
                "jwks",
                "key-1",
                [(
                    "publicKey",
                    Value::from(format!(r#"{{"kty":"OKP","crv":"Ed25519","x":"{public}"}}"#)),
                )],
            )
        })
        .unwrap();
        let auth = Auth::new(db.clone());
        let exp = jsonwebtoken::get_current_timestamp() as i64 + 3600;
        let mut header = Header::new(jsonwebtoken::Algorithm::EdDSA);
        header.kid = Some("key-1".into());
        let once = jsonwebtoken::encode(
            &header,
            &serde_json::json!({
                "sub": "sam",
                "exp": exp,
                "iss": JWT_ISSUER,
                "aud": JWT_AUDIENCE,
                "jti": "bed-1",
            }),
            &encoding,
        )
        .unwrap();
        assert_eq!(auth.verify_jwt(&once).unwrap().id, "sam");
        assert!(
            auth.verify_jwt(&once)
                .unwrap_err()
                .to_string()
                .contains("replayed")
        );
        let again = jsonwebtoken::encode(
            &header,
            &serde_json::json!({
                "sub": "sam",
                "exp": exp,
                "iss": JWT_ISSUER,
                "aud": "other-app",
                "jti": "bed-2",
            }),
            &encoding,
        )
        .unwrap();
        assert!(auth.verify_jwt(&again).is_err());
        let plain = jsonwebtoken::encode(
            &header,
            &serde_json::json!({
                "sub": "sam",
                "exp": exp,
                "iss": JWT_ISSUER,
                "aud": JWT_AUDIENCE,
            }),
            &encoding,
        )
        .unwrap();
        assert_eq!(auth.verify_jwt(&plain).unwrap().id, "sam");
        assert_eq!(auth.verify_jwt(&plain).unwrap().id, "sam");

        db.transact(|tx| {
            tx.upsert(
                "account",
                "link-1",
                [
                    ("accountId", Value::from("ada")),
                    ("providerId", Value::from("oidc")),
                    ("userId", Value::from("sam")),
                ],
            )
        })
        .unwrap();
        let foreign = mint(&header, &encoding, exp, Some("bed-3"), Some("noor"));
        assert!(
            auth.verify_jwt(&foreign)
                .unwrap_err()
                .to_string()
                .contains("unsafe link")
        );
        assert!(
            auth.verify_jwt(&foreign)
                .unwrap_err()
                .to_string()
                .contains("unsafe link")
        );
        let same = mint(&header, &encoding, exp, Some("bed-4"), Some("ada"));
        assert_eq!(auth.verify_jwt(&same).unwrap().id, "sam");
    }

    #[test]
    fn a_rotated_jwt_key_is_rejected_and_the_current_key_still_signs() {
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
        use jsonwebtoken::{EncodingKey, Header};

        let old_key = suiteleaf_net::identity::ed25519::Keypair::generate();
        let new_key = suiteleaf_net::identity::ed25519::Keypair::generate();
        let public = |key: &suiteleaf_net::identity::ed25519::Keypair| {
            URL_SAFE_NO_PAD.encode(key.public().to_bytes())
        };
        let encoding = |key: &suiteleaf_net::identity::ed25519::Keypair| {
            let seed: [u8; 32] = key.to_bytes()[..32].try_into().unwrap();
            EncodingKey::from_ed_der(&ed25519_pkcs8(&seed))
        };
        let db = Arc::new(
            Db::open_in_memory(
                suiteleaf_net::identity::ed25519::Keypair::generate(),
                node_schema(None).unwrap(),
            )
            .unwrap(),
        );
        db.transact(|tx| {
            tx.upsert(
                "jwks",
                "key-old",
                [
                    (
                        "publicKey",
                        Value::from(format!(
                            r#"{{"kty":"OKP","crv":"Ed25519","x":"{}"}}"#,
                            public(&old_key)
                        )),
                    ),
                    ("privateKey", Value::from("secret-value")),
                    ("expiresAt", Value::from("2000-01-01T00:00:00.000Z")),
                ],
            )?;
            tx.upsert(
                "jwks",
                "key-new",
                [(
                    "publicKey",
                    Value::from(format!(
                        r#"{{"kty":"OKP","crv":"Ed25519","x":"{}"}}"#,
                        public(&new_key)
                    )),
                )],
            )
        })
        .unwrap();
        let auth = Auth::new(db);
        let exp = jsonwebtoken::get_current_timestamp() as i64 + 3600;
        let token = |kid: &str, jti: &str, key: &suiteleaf_net::identity::ed25519::Keypair| {
            let mut header = Header::new(jsonwebtoken::Algorithm::EdDSA);
            header.kid = Some(kid.into());
            jsonwebtoken::encode(
                &header,
                &serde_json::json!({
                    "sub": "sam",
                    "exp": exp,
                    "iss": JWT_ISSUER,
                    "aud": JWT_AUDIENCE,
                    "jti": jti,
                }),
                &encoding(key),
            )
            .unwrap()
        };
        let retired = auth
            .verify_jwt(&token("key-old", "old-1", &old_key))
            .unwrap_err();
        assert!(retired.to_string().contains("rotated"));
        assert!(!retired.to_string().contains("secret-value"));
        let again = auth
            .verify_jwt(&token("key-old", "old-2", &old_key))
            .unwrap_err();
        assert!(again.to_string().contains("rotated"));
        assert_eq!(
            auth.verify_jwt(&token("key-new", "new-1", &new_key))
                .unwrap()
                .id,
            "sam"
        );
    }

    #[test]
    fn an_email_outside_the_organization_domain_does_not_sign_in() {
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
        use jsonwebtoken::{EncodingKey, Header};

        let key = suiteleaf_net::identity::ed25519::Keypair::generate();
        let public = URL_SAFE_NO_PAD.encode(key.public().to_bytes());
        let seed: [u8; 32] = key.to_bytes()[..32].try_into().unwrap();
        let encoding = EncodingKey::from_ed_der(&ed25519_pkcs8(&seed));
        let db = Arc::new(
            Db::open_in_memory(
                suiteleaf_net::identity::ed25519::Keypair::generate(),
                node_schema(None).unwrap(),
            )
            .unwrap(),
        );
        db.transact(|tx| {
            tx.upsert(
                "jwks",
                "key-1",
                [(
                    "publicKey",
                    Value::from(format!(r#"{{"kty":"OKP","crv":"Ed25519","x":"{public}"}}"#)),
                )],
            )?;
            tx.upsert(
                "organization",
                "club",
                [("metadata", Value::from(r#"{"domains":["gardenclub.org"]}"#))],
            )?;
            tx.upsert(
                "user",
                "sam",
                [("email", Value::from("sam@gardenclub.org"))],
            )?;
            tx.upsert(
                "account",
                "link-1",
                [
                    ("accountId", Value::from("ada")),
                    ("providerId", Value::from("oidc")),
                    ("userId", Value::from("sam")),
                ],
            )
        })
        .unwrap();
        let auth = Auth::new(db.clone());
        let exp = jsonwebtoken::get_current_timestamp() as i64 + 3600;
        let mut header = Header::new(jsonwebtoken::Algorithm::EdDSA);
        header.kid = Some("key-1".into());
        let token = |email: &str, subject: &str, jti: &str| {
            jsonwebtoken::encode(
                &header,
                &serde_json::json!({
                    "sub": "sam",
                    "email": email,
                    "oidc_sub": subject,
                    "exp": exp,
                    "iss": JWT_ISSUER,
                    "aud": JWT_AUDIENCE,
                    "jti": jti,
                }),
                &encoding,
            )
            .unwrap()
        };
        let outside = auth
            .verify_jwt(&token("secret-value@other.example", "ada", "out-1"))
            .unwrap_err();
        assert!(outside.to_string().contains("email domain"));
        assert!(!outside.to_string().contains("secret-value"));
        let relink = auth
            .verify_jwt(&token("sam@gardenclub.org", "noor", "relink-1"))
            .unwrap_err();
        assert!(relink.to_string().contains("unsafe link"));
        assert_eq!(
            auth.verify_jwt(&token("sam@gardenclub.org", "ada", "ok-1"))
                .unwrap()
                .id,
            "sam"
        );
        let accounts = db.query("SELECT id FROM account", &[]).unwrap();
        assert_eq!(accounts.len(), 1);
    }

    #[test]
    fn an_organization_that_requires_mfa_rejects_a_token_without_it() {
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
        use jsonwebtoken::{EncodingKey, Header};

        let key = suiteleaf_net::identity::ed25519::Keypair::generate();
        let public = URL_SAFE_NO_PAD.encode(key.public().to_bytes());
        let seed: [u8; 32] = key.to_bytes()[..32].try_into().unwrap();
        let encoding = EncodingKey::from_ed_der(&ed25519_pkcs8(&seed));
        let db = Arc::new(
            Db::open_in_memory(
                suiteleaf_net::identity::ed25519::Keypair::generate(),
                node_schema(None).unwrap(),
            )
            .unwrap(),
        );
        db.transact(|tx| {
            tx.upsert(
                "jwks",
                "key-1",
                [(
                    "publicKey",
                    Value::from(format!(r#"{{"kty":"OKP","crv":"Ed25519","x":"{public}"}}"#)),
                )],
            )?;
            tx.upsert(
                "organization",
                "club",
                [("metadata", Value::from(r#"{"mfa":true}"#))],
            )?;
            tx.upsert(
                "user",
                "sam",
                [("email", Value::from("sam@gardenclub.org"))],
            )
        })
        .unwrap();
        let auth = Auth::new(db);
        let exp = jsonwebtoken::get_current_timestamp() as i64 + 3600;
        let mut header = Header::new(jsonwebtoken::Algorithm::EdDSA);
        header.kid = Some("key-1".into());
        let token = |amr: &[&str], jti: &str| {
            jsonwebtoken::encode(
                &header,
                &serde_json::json!({
                    "sub": "sam",
                    "exp": exp,
                    "iss": JWT_ISSUER,
                    "aud": JWT_AUDIENCE,
                    "jti": jti,
                    "amr": amr,
                }),
                &encoding,
            )
            .unwrap()
        };
        let missing = auth
            .verify_jwt(&token(&["pwd", "secret-value"], "bed-1"))
            .unwrap_err();
        assert!(missing.to_string().contains("second factor"));
        assert!(!missing.to_string().contains("secret-value"));
        assert_eq!(
            auth.verify_jwt(&token(&["mfa"], "bed-1")).unwrap().id,
            "sam"
        );
        let replayed = auth.verify_jwt(&token(&["mfa"], "bed-1")).unwrap_err();
        assert!(!replayed.to_string().contains("secret-value"));
    }

    fn mint(
        header: &jsonwebtoken::Header,
        encoding: &jsonwebtoken::EncodingKey,
        exp: i64,
        jti: Option<&str>,
        oidc_sub: Option<&str>,
    ) -> String {
        let mut claims = serde_json::json!({
            "sub": "sam",
            "exp": exp,
            "iss": JWT_ISSUER,
            "aud": JWT_AUDIENCE,
        });
        if let Some(jti) = jti {
            claims["jti"] = serde_json::json!(jti);
        }
        if let Some(oidc_sub) = oidc_sub {
            claims["oidc_sub"] = serde_json::json!(oidc_sub);
        }
        jsonwebtoken::encode(header, &claims, encoding).unwrap()
    }
}
