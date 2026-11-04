//! Checks on one sign-in assertion after it has been decoded.
//! A JWT that carries a `jti` is checked here from `Auth::verify_jwt`.
//! This is not an OIDC or SAML client.

use std::collections::BTreeSet;

use libp2p_identity::ed25519;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Assertion {
    pub issuer: String,
    pub audience: String,
    pub expires_at: i64,
    pub jti: String,
    pub subject: String,
}

#[derive(Default)]
pub struct SeenAssertions {
    jtis: BTreeSet<String>,
}

pub fn accept_assertion(
    assertion: &Assertion,
    now: i64,
    seen: &mut SeenAssertions,
    issuer: &str,
    audience: &str,
) -> Result<(), &'static str> {
    if assertion.issuer != issuer {
        return Err("wrong issuer");
    }
    if assertion.audience != audience {
        return Err("wrong audience");
    }
    if assertion.expires_at <= now {
        return Err("expired");
    }
    if assertion.jti.is_empty() || !seen.jtis.insert(assertion.jti.clone()) {
        return Err("replayed");
    }
    Ok(())
}

/// The bytes a key signs. A field that could change the line breaks is refused.
#[allow(dead_code)]
pub fn assertion_message(assertion: &Assertion) -> Result<Vec<u8>, &'static str> {
    for field in [
        assertion.issuer.as_str(),
        assertion.audience.as_str(),
        assertion.jti.as_str(),
        assertion.subject.as_str(),
    ] {
        if field.is_empty() || field.contains(['\n', '\r']) {
            return Err("the assertion is not signed");
        }
    }
    Ok(format!(
        "{}\n{}\n{}\n{}\n{}",
        assertion.issuer,
        assertion.audience,
        assertion.expires_at,
        assertion.jti,
        assertion.subject
    )
    .into_bytes())
}

/// The assertion must match this public key before the issuer, audience, expiry, and replay checks.
/// This does not sign anyone in.
#[allow(dead_code)]
pub fn verify_signed_assertion(
    assertion: &Assertion,
    signature: &[u8],
    public_key: &[u8],
    now: i64,
    seen: &mut SeenAssertions,
    issuer: &str,
    audience: &str,
) -> Result<(), &'static str> {
    let message = assertion_message(assertion)?;
    let key = ed25519::PublicKey::try_from_bytes(public_key)
        .map_err(|_| "the assertion is not signed")?;
    if !key.verify(&message, signature) {
        return Err("the assertion is not signed");
    }
    accept_assertion(assertion, now, seen, issuer, audience)
}

/// The host after `@` must be one of `allowed`. The local part is not proof of ownership.
/// An empty allow list means no domain rule is configured.
pub fn email_domain_allowed(email: &str, allowed: &[impl AsRef<str>]) -> Result<(), &'static str> {
    if allowed.is_empty() {
        return Ok(());
    }
    let mut parts = email.split('@');
    let local = parts.next().unwrap_or("");
    let host = parts.next().unwrap_or("").trim().trim_end_matches('.');
    if local.is_empty() || host.is_empty() || parts.next().is_some() {
        return Err("email domain is not allowed");
    }
    let host = host.to_ascii_lowercase();
    if allowed
        .iter()
        .any(|domain| domain.as_ref().eq_ignore_ascii_case(&host))
    {
        return Ok(());
    }
    Err("email domain is not allowed")
}

/// A key with no expiry still signs. An expiry at or before `now` has been rotated.
/// An expiry or clock that is not a real UTC instant does not sign.
pub fn key_still_signs(expires_at: &str, now: &str) -> bool {
    if expires_at.is_empty() {
        return true;
    }
    let (Some(end), Some(clock)) = (
        crate::session_policy::parse_iso_ms(expires_at),
        crate::session_policy::parse_iso_ms(now),
    ) else {
        return false;
    };
    end > clock
}

/// An account already linked to another subject is not retied by this assertion.
/// An email-shaped subject is not an account id.
pub fn link_subject(linked: Option<&str>, subject: &str) -> Result<(), &'static str> {
    if subject.trim().is_empty() || subject.contains('@') {
        return Err("the sign-in subject is not an account id");
    }
    match linked {
        Some(current) if current != subject => Err("unsafe link"),
        _ => Ok(()),
    }
}

/// Issuer plus subject. An email-shaped subject is refused, and the refusal does not repeat it.
#[allow(dead_code)]
pub fn external_identity_id(issuer: &str, subject: &str) -> Result<String, &'static str> {
    let issuer = issuer.trim();
    if issuer.is_empty() {
        return Err("the sign-in subject is not an account id");
    }
    link_subject(None, subject)?;
    Ok(format!("{issuer} {subject}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> Assertion {
        Assertion {
            issuer: "https://idp.example".into(),
            audience: "suiteleaf".into(),
            expires_at: 200,
            jti: "jti-1".into(),
            subject: "ada".into(),
        }
    }

    #[test]
    fn an_expired_replayed_or_mismatched_assertion_is_rejected() {
        let mut seen = SeenAssertions::default();
        let ok = fresh();
        assert_eq!(
            accept_assertion(&ok, 100, &mut seen, "https://idp.example", "suiteleaf"),
            Ok(())
        );
        assert_eq!(
            accept_assertion(&ok, 100, &mut seen, "https://idp.example", "suiteleaf"),
            Err("replayed")
        );
        let mut expired = fresh();
        expired.jti = "jti-2".into();
        expired.expires_at = 100;
        assert_eq!(
            accept_assertion(&expired, 100, &mut seen, "https://idp.example", "suiteleaf"),
            Err("expired")
        );
        let mut wrong_issuer = fresh();
        wrong_issuer.jti = "jti-3".into();
        wrong_issuer.issuer = "https://other.example".into();
        assert_eq!(
            accept_assertion(
                &wrong_issuer,
                100,
                &mut seen,
                "https://idp.example",
                "suiteleaf"
            ),
            Err("wrong issuer")
        );
        let mut wrong_audience = fresh();
        wrong_audience.jti = "jti-4".into();
        wrong_audience.audience = "other-app".into();
        assert_eq!(
            accept_assertion(
                &wrong_audience,
                100,
                &mut seen,
                "https://idp.example",
                "suiteleaf"
            ),
            Err("wrong audience")
        );
        let key = ed25519::Keypair::generate();
        let signed = fresh();
        let message = assertion_message(&signed).unwrap();
        let signature = key.sign(&message);
        let mut signed_seen = SeenAssertions::default();
        assert_eq!(
            verify_signed_assertion(
                &signed,
                &signature,
                &key.public().to_bytes(),
                100,
                &mut signed_seen,
                "https://idp.example",
                "suiteleaf"
            ),
            Ok(())
        );
        assert_eq!(
            verify_signed_assertion(
                &signed,
                &signature,
                &key.public().to_bytes(),
                100,
                &mut signed_seen,
                "https://idp.example",
                "suiteleaf"
            ),
            Err("replayed")
        );
        let mut forged = signed.clone();
        forged.jti = "jti-signed".into();
        forged.subject = "secret-value".into();
        let refused = verify_signed_assertion(
            &forged,
            &signature,
            &key.public().to_bytes(),
            100,
            &mut SeenAssertions::default(),
            "https://idp.example",
            "suiteleaf",
        );
        assert_eq!(refused, Err("the assertion is not signed"));
        assert!(!refused.unwrap_err().contains("secret"));
        let broken = assertion_message(&Assertion {
            subject: "secret\nvalue".into(),
            ..fresh()
        });
        assert_eq!(broken, Err("the assertion is not signed"));
        assert!(!broken.unwrap_err().contains("secret"));
        assert_eq!(link_subject(Some("ada"), "ada"), Ok(()));
        assert_eq!(link_subject(None, "ada"), Ok(()));
        assert_eq!(link_subject(Some("ada"), "noor"), Err("unsafe link"));
        let email = link_subject(None, "secret-value@gardenclub.org");
        assert_eq!(email, Err("the sign-in subject is not an account id"));
        assert!(!email.unwrap_err().contains("secret"));
        assert_eq!(
            external_identity_id("https://idp.example", "ada"),
            Ok("https://idp.example ada".into())
        );
        assert_eq!(
            external_identity_id("https://idp.example", "secret-value@gardenclub.org"),
            Err("the sign-in subject is not an account id")
        );
        assert!(key_still_signs("", "2026-10-31T20:00:00.000Z"));
        assert!(key_still_signs(
            "2099-01-01T00:00:00.000Z",
            "2026-10-31T20:00:00.000Z"
        ));
        assert!(!key_still_signs(
            "2000-01-01T00:00:00.000Z",
            "2026-10-31T20:00:00.000Z"
        ));
        assert!(!key_still_signs(
            "2026-10-31T20:00:00.000Z",
            "2026-10-31T20:00:00.000Z"
        ));
        assert!(!key_still_signs("secret-value", "2026-10-31T20:00:00.000Z"));
        assert!(!key_still_signs(
            "2026-11-31T00:00:00.000Z",
            "2026-10-31T20:00:00.000Z"
        ));
        assert!(!key_still_signs("2099-01-01T00:00:00.000Z", "secret-value"));
        assert_eq!(
            email_domain_allowed("sam@gardenclub.org", &[] as &[&str]),
            Ok(())
        );
        assert_eq!(
            email_domain_allowed("Sam@GardenClub.org", &["gardenclub.org"]),
            Ok(())
        );
        assert_eq!(
            email_domain_allowed("secret-value@other.example", &["gardenclub.org"]),
            Err("email domain is not allowed")
        );
        assert_eq!(
            email_domain_allowed("sam@mail.gardenclub.org", &["gardenclub.org"]),
            Err("email domain is not allowed")
        );
        assert_eq!(
            email_domain_allowed("not-an-email", &["gardenclub.org"]),
            Err("email domain is not allowed")
        );
    }
}
