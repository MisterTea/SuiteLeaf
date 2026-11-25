//! Content-addressed sectioned storage for `.slslides` v2 presentations.
//!
//! Instead of storing a presentation as one monolithic JSON blob, a v2
//! `.slslides` version stores `manifest.json` as the version's root content and
//! keeps `global.json`, each `slides/<id>.json`, binary `media/*`, `fonts/*`,
//! thumbnails, and optional `history.json` as independent BLAKE3-addressed
//! blobs in [`BlobStore`]. Unchanged slides and media are deduplicated across
//! versions and never re-uploaded.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::Context;
use serde::{Deserialize, Serialize};
use suitedb::{Value, hlc::iso_now};

use crate::{Drive, DriveError, DriveResult, Hash, Item, Principal, Role, row::text};

pub const SLIDES_V2_MIME: &str = "application/vnd.suiteleaf.slides+zip";
pub const SHEET_V2_MIME: &str = "application/vnd.suiteleaf.sheet+zip";
pub const DOC_V2_MIME: &str = "application/vnd.suiteleaf.doc+zip";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionRef {
    pub hash: String,
    pub size: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideSummary {
    pub hash: String,
    pub size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub master_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumb_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumb_mime: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetSummary {
    pub hash: String,
    pub size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column_count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deps: Option<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocTabSummary {
    pub hash: String,
    pub size: u64,
    pub title: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaEntry {
    pub mime: String,
    pub size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontEntry {
    pub family: String,
    pub style: String,
    pub weight: u16,
    pub mime: String,
    pub size: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideSectionManifest {
    pub format: String,
    pub version: u32,
    pub kind: String,
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub global: SectionRef,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub slide_order: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub slides: BTreeMap<String, SlideSummary>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sheet_order: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub sheets: BTreeMap<String, SheetSummary>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tab_order: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub tabs: BTreeMap<String, DocTabSummary>,
    #[serde(default)]
    pub media: BTreeMap<String, MediaEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fonts: Option<BTreeMap<String, FontEntry>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history: Option<SectionRef>,
}

pub type SectionManifest = SlideSectionManifest;

impl SlideSectionManifest {
    /// Parse `bytes` as a v2 sectioned SuiteLeaf manifest (`slide`, `sheet`, or `doc`).
    pub fn try_parse(bytes: &[u8]) -> Option<Self> {
        if !bytes.starts_with(b"{") {
            return None;
        }
        let manifest: Self = serde_json::from_slice(bytes).ok()?;
        if manifest.format == "suiteleaf"
            && manifest.version == 2
            && matches!(manifest.kind.as_str(), "slide" | "sheet" | "doc")
        {
            Some(manifest)
        } else {
            None
        }
    }

    pub fn mime_type(&self) -> &'static str {
        match self.kind.as_str() {
            "sheet" => SHEET_V2_MIME,
            "doc" => DOC_V2_MIME,
            _ => SLIDES_V2_MIME,
        }
    }

    pub fn section_zip_prefix(&self) -> &'static str {
        match self.kind.as_str() {
            "sheet" => "sheets",
            "doc" => "tabs",
            _ => "slides",
        }
    }

    pub fn section_order(&self) -> &[String] {
        match self.kind.as_str() {
            "sheet" => &self.sheet_order,
            "doc" => &self.tab_order,
            _ => &self.slide_order,
        }
    }

    pub fn section_hash(&self, id: &str) -> Option<&str> {
        match self.kind.as_str() {
            "sheet" => self.sheets.get(id).map(|s| s.hash.as_str()),
            "doc" => self.tabs.get(id).map(|t| t.hash.as_str()),
            _ => self.slides.get(id).map(|s| s.hash.as_str()),
        }
    }

    /// Every BLAKE3 blob hash referenced by this manifest (global, sections, thumbnails, media, fonts, history).
    pub fn referenced_hashes(&self) -> DriveResult<Vec<Hash>> {
        let mut set = BTreeSet::new();
        let parse = |raw: &str| -> DriveResult<Hash> {
            raw.parse::<Hash>()
                .map_err(|_| DriveError::BadRequest(format!("Invalid section hash: {raw}")))
        };
        set.insert(parse(&self.global.hash)?);
        match self.kind.as_str() {
            "sheet" => {
                for sheet_id in &self.sheet_order {
                    let summary = self.sheets.get(sheet_id).ok_or_else(|| {
                        DriveError::BadRequest(format!(
                            "Manifest missing sheet summary for {sheet_id}"
                        ))
                    })?;
                    set.insert(parse(&summary.hash)?);
                }
            }
            "doc" => {
                for tab_id in &self.tab_order {
                    let summary = self.tabs.get(tab_id).ok_or_else(|| {
                        DriveError::BadRequest(format!("Manifest missing tab summary for {tab_id}"))
                    })?;
                    set.insert(parse(&summary.hash)?);
                }
            }
            _ => {
                for slide_id in &self.slide_order {
                    let summary = self.slides.get(slide_id).ok_or_else(|| {
                        DriveError::BadRequest(format!(
                            "Manifest missing slide summary for {slide_id}"
                        ))
                    })?;
                    set.insert(parse(&summary.hash)?);
                    if let Some(thumb) = &summary.thumb_hash {
                        set.insert(parse(thumb)?);
                    }
                }
            }
        }
        for hash in self.media.keys() {
            set.insert(parse(hash)?);
        }
        if let Some(fonts) = &self.fonts {
            for hash in fonts.keys() {
                set.insert(parse(hash)?);
            }
        }
        if let Some(history) = &self.history {
            set.insert(parse(&history.hash)?);
        }
        Ok(set.into_iter().collect())
    }

    /// Whether `hash` is referenced anywhere in this manifest.
    pub fn contains_hash(&self, hash: &Hash) -> bool {
        let hex = hash.to_string();
        if self.global.hash == hex {
            return true;
        }
        if self.media.contains_key(&hex) {
            return true;
        }
        if self.fonts.as_ref().is_some_and(|f| f.contains_key(&hex)) {
            return true;
        }
        if self.history.as_ref().is_some_and(|h| h.hash == hex) {
            return true;
        }
        self.slides
            .values()
            .any(|s| s.hash == hex || s.thumb_hash.as_deref() == Some(hex.as_str()))
            || self.sheets.values().any(|s| s.hash == hex)
            || self.tabs.values().any(|t| t.hash == hex)
    }

    /// Total logical size across all unique sections referenced by this manifest.
    pub fn total_size(&self, manifest_len: usize) -> u64 {
        let mut seen = BTreeSet::new();
        let mut total = manifest_len as u64;
        if seen.insert(self.global.hash.as_str()) {
            total = total.saturating_add(self.global.size);
        }
        for s in self.slides.values() {
            if seen.insert(s.hash.as_str()) {
                total = total.saturating_add(s.size);
            }
        }
        for s in self.sheets.values() {
            if seen.insert(s.hash.as_str()) {
                total = total.saturating_add(s.size);
            }
        }
        for t in self.tabs.values() {
            if seen.insert(t.hash.as_str()) {
                total = total.saturating_add(t.size);
            }
        }
        for (h, m) in &self.media {
            if seen.insert(h.as_str()) {
                total = total.saturating_add(m.size);
            }
        }
        if let Some(fonts) = &self.fonts {
            for (h, f) in fonts {
                if seen.insert(h.as_str()) {
                    total = total.saturating_add(f.size);
                }
            }
        }
        if let Some(h) = &self.history
            && seen.insert(h.hash.as_str())
        {
            total = total.saturating_add(h.size);
        }
        total
    }
}

impl Drive {
    /// Return which of `hashes` are not yet present in the local BlobStore.
    pub fn missing_blobs(
        &self,
        who: &Principal,
        id: &str,
        hashes: &[Hash],
    ) -> DriveResult<Vec<Hash>> {
        if !matches!(self.role(who, id)?, Some(role) if role >= Role::Editor) {
            return Err(DriveError::Forbidden);
        }
        let mut missing = Vec::new();
        for hash in hashes {
            if !self.blobs.has(hash) {
                missing.push(*hash);
            }
        }
        Ok(missing)
    }

    /// Upload a single content-addressed blob for an item after verifying its BLAKE3 hash.
    pub fn put_item_blob(
        &self,
        who: &Principal,
        id: &str,
        hash: Hash,
        bytes: &[u8],
    ) -> DriveResult<()> {
        if !matches!(self.role(who, id)?, Some(role) if role >= Role::Editor) {
            return Err(DriveError::Forbidden);
        }
        if bytes.len() > 512 * 1024 * 1024 {
            return Err(DriveError::BadRequest("Blob exceeds maximum size.".into()));
        }
        let row = self.item_row(id)?;
        if text(&row, "kind").as_deref() != Some("file") {
            return Err(DriveError::BadRequest("Folders have no content.".into()));
        }
        if Hash::of(bytes) != hash {
            return Err(DriveError::BadRequest("Blob hash mismatch.".into()));
        }
        if self.blobs.has(&hash) {
            return Ok(());
        }
        self.ensure_room_bytes(bytes.len() as u64)?;
        self.blobs
            .put_verified(&hash, bytes)
            .map_err(DriveError::Other)?;
        Ok(())
    }

    /// Upload one contiguous slice of a large content-addressed blob.
    /// Returns `Ok(None)` while more bytes remain, or `Ok(Some(()))` once the full blob
    /// has been verified against `hash` and stored.
    pub fn put_item_blob_span(
        &self,
        who: &Principal,
        id: &str,
        hash: Hash,
        start: usize,
        total: usize,
        chunk: &[u8],
    ) -> DriveResult<Option<()>> {
        let partial_key = format!("blob-{hash}");
        let _lock = self.db.exclusive(&partial_key)?;
        if !matches!(self.role(who, id)?, Some(role) if role >= Role::Editor) {
            return Err(DriveError::Forbidden);
        }
        let row = self.item_row(id)?;
        if text(&row, "kind").as_deref() != Some("file") {
            return Err(DriveError::BadRequest("Folders have no content.".into()));
        }
        if total > 512 * 1024 * 1024 || start > total || chunk.len() > total - start {
            return Err(DriveError::BadRequest(
                "That upload does not continue the saved part.".into(),
            ));
        }
        // Short-circuit if this content-addressed blob is already stored.
        if self.blobs.has(&hash) {
            return Ok(Some(()));
        }
        if total == 0 {
            self.blobs
                .put_verified(&hash, &[])
                .map_err(|_| DriveError::BadRequest("Blob hash mismatch.".into()))?;
            return Ok(Some(()));
        }
        self.ensure_room_bytes(total as u64)?;
        if self.db.is_postgres() {
            return self.put_cloud_blob_span(who, &partial_key, hash, start, total, chunk);
        }
        let Some(finished) = self.append_partial_upload(&partial_key, start, total, chunk)? else {
            return Ok(None);
        };
        if Hash::of(&finished) != hash {
            return Err(DriveError::BadRequest("Blob hash mismatch.".into()));
        }
        self.blobs
            .put_verified(&hash, &finished)
            .map_err(DriveError::Other)?;
        Ok(Some(()))
    }

    /// Commit a new v2 sectioned `.slslides` version from its `manifest.json`.
    /// Verifies `If-Match` optimistic locking and that every referenced blob exists.
    pub fn commit_sections(
        &self,
        who: &Principal,
        id: &str,
        if_match: Option<&str>,
        manifest_bytes: &[u8],
    ) -> DriveResult<Item> {
        let _lock = self.db.exclusive(&format!("file:{id}"))?;
        if !matches!(self.role(who, id)?, Some(role) if role >= Role::Editor) {
            return Err(DriveError::Forbidden);
        }
        let row = self.item_row(id)?;
        if text(&row, "kind").as_deref() != Some("file") {
            return Err(DriveError::BadRequest("Folders have no content.".into()));
        }
        let head = text(&row, "headVersionId");
        if let Some(expected) = if_match.map(|m| m.trim_matches('"'))
            && expected != "*"
            && Some(expected) != head.as_deref()
        {
            let role = self.role(who, id)?;
            return Err(DriveError::Conflict(Box::new(self.to_item(&row, role)?)));
        }
        let manifest = SlideSectionManifest::try_parse(manifest_bytes)
            .ok_or_else(|| DriveError::BadRequest("Invalid v2 section manifest.".into()))?;
        if manifest.section_order().is_empty() {
            return Err(DriveError::BadRequest(
                "Package must contain at least one section.".into(),
            ));
        }
        let mime_type = manifest.mime_type();
        let referenced = manifest.referenced_hashes()?;
        for hash in &referenced {
            if !self.blobs.has(hash) {
                return Err(DriveError::BadRequest(format!(
                    "Missing referenced blob {hash}"
                )));
            }
        }
        let content_hash = self
            .blobs
            .put_content(manifest_bytes)
            .context("store section manifest")?;
        if let Some(head_id) = head
            && let Some(current) = self.db.get("drive_version", &head_id)?
            && text(&current, "contentHash").as_deref() == Some(content_hash.to_string().as_str())
        {
            return self.get(who, id);
        }
        let version = uuid::Uuid::now_v7().to_string();
        let now = iso_now();
        let size = manifest.total_size(manifest_bytes.len()) as i64;
        self.db.transact(|tx| {
            tx.upsert(
                "drive_version",
                &version,
                [
                    ("itemId", Value::from(id)),
                    ("contentHash", content_hash.to_string().into()),
                    ("size", Value::Integer(size)),
                    ("authorId", who.id.clone().into()),
                    ("createdAt", now.clone().into()),
                ],
            )?;
            tx.upsert(
                "drive_item",
                id,
                [
                    ("headVersionId", Value::Text(version.clone())),
                    ("size", Value::Integer(size)),
                    ("updatedAt", now.clone().into()),
                    ("mime", Value::Text(mime_type.into())),
                ],
            )
        })?;
        self.get(who, id)
    }

    /// Read a v2 sectioned presentation's manifest (returning `None` if the file is not v2 sectioned).
    pub fn read_section_manifest(
        &self,
        who: &Principal,
        id: &str,
        version: Option<&str>,
    ) -> DriveResult<Option<(Item, SlideSectionManifest, Vec<u8>)>> {
        let (item, bytes) = self.read(who, id, version)?;
        let Some(manifest) = SlideSectionManifest::try_parse(&bytes) else {
            return Ok(None);
        };
        Ok(Some((item, manifest, bytes)))
    }

    /// Read one blob referenced by an item's v2 manifest. Verifies both item read
    /// permission and that `hash` belongs to the item (preventing cross-item probing).
    pub fn read_item_blob(
        &self,
        who: &Principal,
        id: &str,
        version: Option<&str>,
        hash: Hash,
    ) -> DriveResult<Vec<u8>> {
        let Some((_, manifest, _)) = self.read_section_manifest(who, id, version)? else {
            return Err(DriveError::NotFound);
        };
        if !manifest.contains_hash(&hash) {
            return Err(DriveError::NotFound);
        }
        self.blobs
            .get(&hash)
            .map_err(DriveError::Other)?
            .ok_or(DriveError::Unavailable)
    }

    /// Assemble a standard `.slslides` v2 ZIP archive on the fly from a sectioned manifest.
    pub fn assemble_sectioned_zip(
        &self,
        manifest: &SlideSectionManifest,
        manifest_bytes: &[u8],
    ) -> DriveResult<Vec<u8>> {
        let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
        entries.push(("manifest.json".into(), manifest_bytes.to_vec()));

        let read_req = |raw: &str| -> DriveResult<Vec<u8>> {
            let hash: Hash = raw
                .parse()
                .map_err(|_| DriveError::Other(anyhow::anyhow!("invalid hash {raw}")))?;
            self.blobs
                .get(&hash)
                .map_err(DriveError::Other)?
                .ok_or(DriveError::Unavailable)
        };

        entries.push(("global.json".into(), read_req(&manifest.global.hash)?));

        let prefix = manifest.section_zip_prefix();
        for section_id in manifest.section_order() {
            if let Some(hash) = manifest.section_hash(section_id) {
                entries.push((format!("{prefix}/{section_id}.json"), read_req(hash)?));
            }
        }

        for (hash, entry) in &manifest.media {
            let ext = entry.ext.as_deref().unwrap_or("bin");
            entries.push((format!("media/{hash}.{ext}"), read_req(hash)?));
        }

        if let Some(fonts) = &manifest.fonts {
            for (hash, entry) in fonts {
                let ext = font_ext(&entry.mime);
                entries.push((format!("fonts/{hash}.{ext}"), read_req(hash)?));
            }
        }

        if let Some(history) = &manifest.history {
            entries.push(("history.json".into(), read_req(&history.hash)?));
        }

        Ok(build_store_zip(&entries))
    }

    pub(crate) fn ensure_room_bytes(&self, incoming: u64) -> DriveResult<()> {
        let budget = *self.storage_budget.lock().expect("storage budget");
        let Some(budget) = budget else {
            return Ok(());
        };
        let stored = self.blobs.stored_bytes().map_err(DriveError::Other)?;
        if stored.saturating_add(incoming) > budget {
            return Err(DriveError::NoRoom);
        }
        Ok(())
    }
}

fn font_ext(mime: &str) -> &'static str {
    match mime.to_ascii_lowercase().as_str() {
        "font/woff2" | "application/font-woff2" => "woff2",
        "font/woff" | "application/font-woff" => "woff",
        "font/ttf" => "ttf",
        "font/otf" => "otf",
        _ => "bin",
    }
}

/// Standard IEEE 802.3 CRC32 for PKZIP headers.
fn crc32(bytes: &[u8]) -> u32 {
    let mut crc: u32 = 0xffff_ffff;
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

/// Minimal, zero-dependency PKZIP (STORE method 0) archive writer.
fn build_store_zip(entries: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut central = Vec::new();

    for (name, data) in entries {
        let name_bytes = name.as_bytes();
        let crc = crc32(data);
        let len = data.len() as u32;
        let offset = out.len() as u32;

        // Local file header
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes()); // version needed
        out.extend_from_slice(&0x0800u16.to_le_bytes()); // UTF-8 flag
        out.extend_from_slice(&0u16.to_le_bytes()); // method: STORE
        out.extend_from_slice(&0u16.to_le_bytes()); // mod time
        out.extend_from_slice(&0u16.to_le_bytes()); // mod date
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // extra len
        out.extend_from_slice(name_bytes);
        out.extend_from_slice(data);

        // Central directory header
        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes()); // version made by
        central.extend_from_slice(&20u16.to_le_bytes()); // version needed
        central.extend_from_slice(&0x0800u16.to_le_bytes()); // UTF-8 flag
        central.extend_from_slice(&0u16.to_le_bytes()); // method: STORE
        central.extend_from_slice(&0u16.to_le_bytes()); // mod time
        central.extend_from_slice(&0u16.to_le_bytes()); // mod date
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&len.to_le_bytes());
        central.extend_from_slice(&len.to_le_bytes());
        central.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes()); // extra len
        central.extend_from_slice(&0u16.to_le_bytes()); // comment len
        central.extend_from_slice(&0u16.to_le_bytes()); // disk number
        central.extend_from_slice(&0u16.to_le_bytes()); // internal attrs
        central.extend_from_slice(&0u32.to_le_bytes()); // external attrs
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(name_bytes);
    }

    let cd_offset = out.len() as u32;
    let cd_size = central.len() as u32;
    let count = entries.len() as u16;
    out.extend_from_slice(&central);

    // End of Central Directory record
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // disk number
    out.extend_from_slice(&0u16.to_le_bytes()); // cd start disk
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&cd_size.to_le_bytes());
    out.extend_from_slice(&cd_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // comment len

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tables;
    use serde_json::json;
    use std::sync::Arc;
    use suitedb::Db;

    fn test_drive() -> (tempfile::TempDir, Arc<Drive>, Principal) {
        let dir = tempfile::tempdir().unwrap();
        let key = libp2p_identity::ed25519::Keypair::generate();
        let schema = suitedb::Schema {
            version: crate::SCHEMA_VERSION,
            tables: tables(),
        };
        let db = Arc::new(Db::open(&dir.path().join("db.sqlite"), key, schema).unwrap());
        let drive = Drive::open(db, &dir.path().join("blobs")).unwrap();
        let alice = Principal {
            id: "alice".into(),
            admin: false,
        };
        (dir, drive, alice)
    }

    #[test]
    fn sectioned_commit_delta_sync_and_acl_isolation() {
        let (_dir, drive, alice) = test_drive();
        let bob = Principal {
            id: "bob".into(),
            admin: false,
        };
        let item = drive
            .create(&alice, None, "Deck.slslides", "file", None)
            .unwrap();
        let other = drive
            .create(&bob, None, "Other.slslides", "file", None)
            .unwrap();

        let global_bytes = br#"{"id":"d1","width":960,"height":540}"#;
        let s1_bytes = br#"{"id":"s1","title":"Intro","elements":[{"id":"e1","type":"text","content":"Quarterly revenue"}],"notes":"Opening remarks"}"#;
        let s2_bytes = br#"{"id":"s2","title":"Roadmap","elements":[{"id":"e2","type":"text","content":"Next milestones"}]}"#;
        let thumb_bytes = br#"<svg xmlns="http://www.w3.org/2000/svg"/>"#;

        let gh = Hash::of(global_bytes);
        let s1h = Hash::of(s1_bytes);
        let s2h = Hash::of(s2_bytes);
        let th = Hash::of(thumb_bytes);

        let missing = drive
            .missing_blobs(&alice, &item.id, &[gh, s1h, s2h, th])
            .unwrap();
        assert_eq!(missing.len(), 4);

        drive
            .put_item_blob(&alice, &item.id, gh, global_bytes)
            .unwrap();
        drive
            .put_item_blob(&alice, &item.id, s1h, s1_bytes)
            .unwrap();
        drive
            .put_item_blob(&alice, &item.id, s2h, s2_bytes)
            .unwrap();
        drive
            .put_item_blob(&alice, &item.id, th, thumb_bytes)
            .unwrap();

        // Hash mismatch is rejected
        assert!(
            drive
                .put_item_blob(&alice, &item.id, s1h, b"tampered")
                .is_err()
        );

        let manifest_v1 = serde_json::to_vec(&json!({
            "format": "suiteleaf",
            "version": 2,
            "kind": "slide",
            "id": "d1",
            "title": "Deck",
            "createdAt": "2026-11-25T15:00:00.000Z",
            "updatedAt": "2026-11-25T15:00:00.000Z",
            "global": { "hash": gh.to_string(), "size": global_bytes.len() },
            "slideOrder": ["s1", "s2"],
            "slides": {
                "s1": { "hash": s1h.to_string(), "size": s1_bytes.len(), "title": "Intro", "thumbHash": th.to_string(), "thumbMime": "image/svg+xml" },
                "s2": { "hash": s2h.to_string(), "size": s2_bytes.len(), "title": "Roadmap" }
            },
            "media": {
                th.to_string(): { "mime": "image/svg+xml", "size": thumb_bytes.len(), "ext": "svg" }
            }
        }))
        .unwrap();

        let committed_v1 = drive
            .commit_sections(&alice, &item.id, None, &manifest_v1)
            .unwrap();
        assert_eq!(committed_v1.mime.as_deref(), Some(SLIDES_V2_MIME));
        let v1_id = committed_v1.head_version_id.clone().unwrap();

        // Search indexes text from v2 slide blobs
        let hits = drive.search(&alice, "Quarterly revenue").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, item.id);

        // Bob cannot probe Alice's blob via his own item
        assert!(drive.read_item_blob(&bob, &other.id, None, s1h).is_err());
        assert_eq!(
            drive.read_item_blob(&alice, &item.id, None, s1h).unwrap(),
            s1_bytes
        );

        // Delta commit: edit only s2, do NOT re-upload global, s1, or thumb
        let s2_v2 = br#"{"id":"s2","title":"Roadmap","elements":[{"id":"e2","type":"text","content":"Updated milestones"}]}"#;
        let s2h_v2 = Hash::of(s2_v2);
        let missing_v2 = drive
            .missing_blobs(&alice, &item.id, &[gh, s1h, s2h_v2, th])
            .unwrap();
        assert_eq!(missing_v2, vec![s2h_v2]);
        drive
            .put_item_blob(&alice, &item.id, s2h_v2, s2_v2)
            .unwrap();

        let manifest_v2 = serde_json::to_vec(&json!({
            "format": "suiteleaf",
            "version": 2,
            "kind": "slide",
            "id": "d1",
            "title": "Deck",
            "createdAt": "2026-11-25T15:00:00.000Z",
            "updatedAt": "2026-11-25T15:05:00.000Z",
            "global": { "hash": gh.to_string(), "size": global_bytes.len() },
            "slideOrder": ["s1", "s2"],
            "slides": {
                "s1": { "hash": s1h.to_string(), "size": s1_bytes.len(), "title": "Intro", "thumbHash": th.to_string(), "thumbMime": "image/svg+xml" },
                "s2": { "hash": s2h_v2.to_string(), "size": s2_v2.len(), "title": "Roadmap" }
            },
            "media": {
                th.to_string(): { "mime": "image/svg+xml", "size": thumb_bytes.len(), "ext": "svg" }
            }
        }))
        .unwrap();

        // Wrong If-Match produces Conflict
        assert!(matches!(
            drive.commit_sections(&alice, &item.id, Some("stale-version"), &manifest_v2),
            Err(DriveError::Conflict(_))
        ));

        let committed_v2 = drive
            .commit_sections(&alice, &item.id, Some(&v1_id), &manifest_v2)
            .unwrap();
        assert_ne!(committed_v2.head_version_id, Some(v1_id));

        // On-the-fly ZIP assembly produces valid PKZIP magic bytes
        let (_, parsed_manifest, raw_manifest) = drive
            .read_section_manifest(&alice, &item.id, None)
            .unwrap()
            .unwrap();
        let zip = drive
            .assemble_sectioned_zip(&parsed_manifest, &raw_manifest)
            .unwrap();
        assert_eq!(&zip[..4], b"PK\x03\x04");
        assert!(zip.windows(13).any(|w| w == b"manifest.json"));
        assert!(zip.windows(14).any(|w| w == b"slides/s2.json"));
    }

    #[test]
    fn sectioned_doc_and_sheet_commits_search_and_zip_assembly() {
        let (_dir, drive, alice) = test_drive();

        // 1. v2 .sldoc
        let doc_item = drive
            .create(&alice, None, "Spec.sldoc", "file", None)
            .unwrap();
        let doc_global = br#"{"tabTitle":"Overview"}"#;
        let tab_main = br#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Distributed storage design"}]}]}"#;
        let dgh = Hash::of(doc_global);
        let tmh = Hash::of(tab_main);
        drive
            .put_item_blob(&alice, &doc_item.id, dgh, doc_global)
            .unwrap();
        drive
            .put_item_blob(&alice, &doc_item.id, tmh, tab_main)
            .unwrap();

        let doc_manifest = serde_json::to_vec(&json!({
            "format": "suiteleaf",
            "version": 2,
            "kind": "doc",
            "id": "doc-1",
            "title": "Spec",
            "createdAt": "2026-11-25T15:00:00.000Z",
            "updatedAt": "2026-11-25T15:00:00.000Z",
            "global": { "hash": dgh.to_string(), "size": doc_global.len() },
            "tabOrder": ["main"],
            "tabs": {
                "main": { "hash": tmh.to_string(), "size": tab_main.len(), "title": "Overview" }
            },
            "media": {}
        }))
        .unwrap();
        let committed_doc = drive
            .commit_sections(&alice, &doc_item.id, None, &doc_manifest)
            .unwrap();
        assert_eq!(committed_doc.mime.as_deref(), Some(DOC_V2_MIME));
        assert_eq!(
            drive.search(&alice, "Distributed storage").unwrap().len(),
            1
        );
        let (_, dm, dmr) = drive
            .read_section_manifest(&alice, &doc_item.id, None)
            .unwrap()
            .unwrap();
        let doc_zip = drive.assemble_sectioned_zip(&dm, &dmr).unwrap();
        assert!(doc_zip.windows(14).any(|w| w == b"tabs/main.json"));

        // 2. v2 .slsheet
        let sheet_item = drive
            .create(&alice, None, "Budget.slsheet", "file", None)
            .unwrap();
        let sheet_global = br#"{"workbookMeta":{"id":"wb1"},"charts":[],"pivots":[]}"#;
        let ws1 =
            br#"{"id":"ws1","name":"Summary","cellData":{"0":{"0":{"v":"EBITDA forecast"}}}}"#;
        let sgh = Hash::of(sheet_global);
        let ws1h = Hash::of(ws1);
        drive
            .put_item_blob(&alice, &sheet_item.id, sgh, sheet_global)
            .unwrap();
        drive
            .put_item_blob(&alice, &sheet_item.id, ws1h, ws1)
            .unwrap();

        let sheet_manifest = serde_json::to_vec(&json!({
            "format": "suiteleaf",
            "version": 2,
            "kind": "sheet",
            "id": "wb1",
            "title": "Budget",
            "createdAt": "2026-11-25T15:00:00.000Z",
            "updatedAt": "2026-11-25T15:00:00.000Z",
            "global": { "hash": sgh.to_string(), "size": sheet_global.len() },
            "sheetOrder": ["ws1"],
            "sheets": {
                "ws1": { "hash": ws1h.to_string(), "size": ws1.len(), "name": "Summary" }
            },
            "media": {}
        }))
        .unwrap();
        let committed_sheet = drive
            .commit_sections(&alice, &sheet_item.id, None, &sheet_manifest)
            .unwrap();
        assert_eq!(committed_sheet.mime.as_deref(), Some(SHEET_V2_MIME));
        assert_eq!(drive.search(&alice, "EBITDA forecast").unwrap().len(), 1);
        let (_, sm, smr) = drive
            .read_section_manifest(&alice, &sheet_item.id, None)
            .unwrap()
            .unwrap();
        let sheet_zip = drive.assemble_sectioned_zip(&sm, &smr).unwrap();
        assert!(sheet_zip.windows(15).any(|w| w == b"sheets/ws1.json"));
    }

    #[test]
    fn put_item_blob_span_appends_verifies_and_deduplicates() {
        let (_dir, drive, alice) = test_drive();
        let item = drive
            .create(&alice, None, "Lecture.slslides", "file", None)
            .unwrap();

        let payload: Vec<u8> = (0..10_000).map(|i| (i % 251) as u8).collect();
        let hash = Hash::of(&payload);

        // Upload in 3 chunks
        assert!(
            drive
                .put_item_blob_span(&alice, &item.id, hash, 0, payload.len(), &payload[..4000])
                .unwrap()
                .is_none()
        );
        assert!(
            drive
                .put_item_blob_span(
                    &alice,
                    &item.id,
                    hash,
                    4000,
                    payload.len(),
                    &payload[4000..8000]
                )
                .unwrap()
                .is_none()
        );
        assert!(
            drive
                .put_item_blob_span(
                    &alice,
                    &item.id,
                    hash,
                    8000,
                    payload.len(),
                    &payload[8000..]
                )
                .unwrap()
                .is_some()
        );
        assert_eq!(drive.blobs().get(&hash).unwrap().unwrap(), payload);

        // Dedup short-circuit when blob already exists
        assert!(
            drive
                .put_item_blob_span(&alice, &item.id, hash, 0, payload.len(), &payload[..10])
                .unwrap()
                .is_some()
        );

        // Hash mismatch fails
        let bad_hash = Hash::of(b"something else");
        assert!(
            drive
                .put_item_blob_span(&alice, &item.id, bad_hash, 0, 4, b"nope")
                .is_err()
        );
    }
}
