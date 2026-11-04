//! File routes over HTTP: a ranged upload and a scheduled backup.

use serde_json::{Value, json};

use crate::support::*;

#[tokio::test]
async fn the_desktop_app_may_send_a_ranged_upload_across_origins() {
    let dir = tempfile::tempdir().unwrap();
    init(dir.path(), None);
    let node = start(dir.path(), None);
    let preflight = reqwest::Client::new()
        .request(
            reqwest::Method::OPTIONS,
            format!("{}/api/drive/items/notes/content", node.http),
        )
        .header("origin", "suiteleaf://app")
        .header("access-control-request-method", "PUT")
        .header(
            "access-control-request-headers",
            "authorization,content-type,content-range,if-match",
        )
        .send()
        .await
        .unwrap();
    assert!(preflight.status().is_success(), "{}", preflight.status());
    let allowed = preflight
        .headers()
        .get("access-control-allow-headers")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    for name in ["authorization", "content-type", "content-range", "if-match"] {
        assert!(allowed.contains(name), "{name} is not allowed: {allowed}");
    }
}

#[tokio::test]
async fn a_content_range_upload_finishes_over_http() {
    let dir = tempfile::tempdir().unwrap();
    init(dir.path(), None);
    let node = start(dir.path(), None);
    let http = reqwest::Client::new();
    for (model, data) in [
        (
            "user",
            json!({
                "id": "ada",
                "name": "Ada",
                "email": "ada@gardenclub.org",
                "role": "user",
                "emailVerified": 1,
                "createdAt": AT,
                "updatedAt": AT
            }),
        ),
        (
            "session",
            json!({
                "id": "ada-session",
                "token": "ada-token",
                "userId": "ada",
                "expiresAt": "2099-01-01T00:00:00.000Z",
                "createdAt": AT,
                "updatedAt": AT
            }),
        ),
    ] {
        let response = http
            .post(format!("{}/internal/db", node.internal))
            .header("x-suiteleaf-internal", TOKEN)
            .json(&json!({ "op": "create", "model": model, "data": data }))
            .send()
            .await
            .unwrap();
        assert!(response.status().is_success(), "{model}");
    }
    let created = http
        .post(format!("{}/api/drive/items", node.http))
        .header("authorization", "Bearer ada-token")
        .json(&json!({
            "name": "Notes.sldoc",
            "kind": "file",
            "mime": "text/plain"
        }))
        .send()
        .await
        .unwrap();
    assert!(created.status().is_success(), "{}", created.status());
    let item = created.json::<Value>().await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let path = format!("{}/api/drive/items/{item}/content", node.http);
    let first = http
        .put(&path)
        .header("authorization", "Bearer ada-token")
        .header("content-type", "text/plain")
        .header("content-range", "bytes 0-3/10")
        .body("Beds")
        .send()
        .await
        .unwrap();
    assert_eq!(first.status(), reqwest::StatusCode::ACCEPTED);
    let first_body = first.text().await.unwrap();
    assert!(first_body.contains("\"accepted\":4"), "{first_body}");
    assert!(!first_body.contains("Beds"), "{first_body}");
    let gap = http
        .put(&path)
        .header("authorization", "Bearer ada-token")
        .header("content-type", "text/plain")
        .header("content-range", "bytes 6-9/10")
        .body("secret-value")
        .send()
        .await
        .unwrap();
    assert_eq!(gap.status(), reqwest::StatusCode::BAD_REQUEST);
    let gap_body = gap.text().await.unwrap();
    assert!(
        gap_body.contains("That upload does not continue the saved part."),
        "{gap_body}"
    );
    assert!(!gap_body.contains("secret-value"), "{gap_body}");
    let done = http
        .put(&path)
        .header("authorization", "Bearer ada-token")
        .header("content-type", "text/plain")
        .header("content-range", "bytes 4-9/10")
        .body(" north")
        .send()
        .await
        .unwrap();
    assert!(done.status().is_success(), "{}", done.status());
    let read = http
        .get(&path)
        .header("authorization", "Bearer ada-token")
        .send()
        .await
        .unwrap();
    assert!(read.status().is_success());
    assert_eq!(read.text().await.unwrap(), "Beds north");
    let blank = http
        .post(format!("{}/api/drive/items", node.http))
        .header("authorization", "Bearer ada-token")
        .json(&json!({
            "name": "Blank.sldoc",
            "kind": "file",
            "mime": "text/plain"
        }))
        .send()
        .await
        .unwrap();
    assert!(blank.status().is_success(), "{}", blank.status());
    let blank_id = blank.json::<Value>().await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let blank_path = format!("{}/api/drive/items/{blank_id}/content", node.http);
    let empty = http
        .put(&blank_path)
        .header("authorization", "Bearer ada-token")
        .header("content-type", "text/plain")
        .header("content-range", "bytes 0-0/0")
        .body("")
        .send()
        .await
        .unwrap();
    assert!(empty.status().is_success(), "{}", empty.status());
    let empty_body = empty.text().await.unwrap();
    assert!(!empty_body.contains("secret-value"), "{empty_body}");
    let empty_read = http
        .get(&blank_path)
        .header("authorization", "Bearer ada-token")
        .send()
        .await
        .unwrap();
    assert!(empty_read.status().is_success());
    assert_eq!(empty_read.text().await.unwrap(), "");
}

#[tokio::test]
async fn a_due_backup_seals_the_live_file_over_http() {
    let dir = tempfile::tempdir().unwrap();
    init(dir.path(), None);
    let key_path = dir.path().join("backup.key");
    std::fs::write(&key_path, [7u8; 32]).unwrap();
    let sealed = dir.path().join("sealed").join("backup.seal");
    let copy = dir.path().join("away").join("backup.seal");
    let fresh = dir.path().join("fresh");
    std::fs::create_dir_all(sealed.parent().unwrap()).unwrap();
    std::fs::create_dir_all(copy.parent().unwrap()).unwrap();
    let node = start_env(
        dir.path(),
        None,
        None,
        &[
            ("SUITELEAF_BACKUP_EVERY_HOURS", "24"),
            ("SUITELEAF_BACKUP_KEY_FILE", key_path.to_str().unwrap()),
            ("SUITELEAF_BACKUP_SEALED", sealed.to_str().unwrap()),
            ("SUITELEAF_BACKUP_COPY", copy.to_str().unwrap()),
            ("SUITELEAF_BACKUP_DIR", fresh.to_str().unwrap()),
        ],
    );
    let http = reqwest::Client::new();
    for (model, data) in [
        (
            "user",
            json!({
                "id": "ada",
                "name": "Ada",
                "email": "ada@gardenclub.org",
                "role": "admin",
                "emailVerified": 1,
                "createdAt": AT,
                "updatedAt": AT
            }),
        ),
        (
            "session",
            json!({
                "id": "ada-session",
                "token": "ada-token",
                "userId": "ada",
                "expiresAt": "2099-01-01T00:00:00.000Z",
                "createdAt": AT,
                "updatedAt": AT
            }),
        ),
    ] {
        let response = http
            .post(format!("{}/internal/db", node.internal))
            .header("x-suiteleaf-internal", TOKEN)
            .json(&json!({ "op": "create", "model": model, "data": data }))
            .send()
            .await
            .unwrap();
        assert!(response.status().is_success(), "{model}");
    }
    let created = http
        .post(format!("{}/api/drive/items", node.http))
        .header("authorization", "Bearer ada-token")
        .json(&json!({
            "name": "Notes.sldoc",
            "kind": "file",
            "mime": "text/plain"
        }))
        .send()
        .await
        .unwrap();
    assert!(created.status().is_success(), "{}", created.status());
    let item = created.json::<Value>().await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let wrote = http
        .put(format!("{}/api/drive/items/{item}/content", node.http))
        .header("authorization", "Bearer ada-token")
        .header("content-type", "text/plain")
        .body("keep this")
        .send()
        .await
        .unwrap();
    assert!(wrote.status().is_success(), "{}", wrote.status());
    let ran = http
        .post(format!("{}/api/admin/backup", node.http))
        .header("authorization", "Bearer ada-token")
        .send()
        .await
        .unwrap();
    assert!(ran.status().is_success(), "{}", ran.status());
    let body = ran.text().await.unwrap();
    assert!(body.contains("\"wrote\":true"), "{body}");
    assert!(body.contains("No backup has been recorded."), "{body}");
    assert!(!body.contains("secret-value"), "{body}");
    assert!(!body.contains("keep this"), "{body}");
    let again = http
        .post(format!("{}/api/admin/backup", node.http))
        .header("authorization", "Bearer ada-token")
        .send()
        .await
        .unwrap();
    let again_body = again.text().await.unwrap();
    assert!(again_body.contains("\"wrote\":false"), "{again_body}");
    assert!(
        again_body.contains("The last backup is still inside the schedule."),
        "{again_body}"
    );
    assert!(!again_body.contains("secret-value"), "{again_body}");
    let opened = dir.path().join("opened");
    let manifest = suitedrive::seal::open_sealed(&copy, &[7u8; 32], &opened).unwrap();
    assert!(!manifest.recorded_at.is_empty());
    assert_eq!(
        suitedrive::blobs::BlobStore::open(&opened.join("blobs"))
            .unwrap()
            .get_content(&manifest.contents[0].parse().unwrap())
            .unwrap()
            .unwrap(),
        b"keep this"
    );
}
