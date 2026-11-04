import { Type } from "@earendil-works/pi-ai";
import {
  applyParagraphRestore,
  compareParagraphs,
  parseFile,
  sameJson,
  type DocFile,
  type FileRecord,
  type JsonNode,
  type ParagraphOffer,
  type SuiteFile,
} from "@suiteleaf/core";
import { replaceDocument } from "../../editors/doc-suggestions";
import { localVersions, recordLocalParagraphRestore } from "../../editors/local-versions";
import { partialRestoreTitle } from "../../editors/version-history-model";
import { DriveConflict, drive, uploadDriveFile } from "../../node-client";
import { storage } from "../../storage";
import { applyRestoredFile } from "../restored-file";
import { ToolError, tool, type SuiteTool } from "../host";
import type { DocsAgentContext } from "./docs";
import { firstString, unwrapName } from "./doc-args";

function openFileId() {
  const match = /\/file\/([^/?#]+)/.exec(`${location.pathname}${location.hash}`);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function paragraphWords(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The changed block `query` names: a compare key, a label such as north-bed, or the older text. */
function pickParagraphOffer(offers: ParagraphOffer[], query: string): ParagraphOffer {
  const raw = query.trim();
  const q = paragraphWords(raw);
  if (!raw || /^(all|whole|everything|document|file|entire)$/.test(q))
    throw new ToolError(
      'Name the one paragraph to restore, such as north-bed or "North bed: 6am". This does not restore the whole document.',
    );
  const ranked = offers
    .map((offer) => {
      const label = paragraphWords(offer.label.replace(/-/g, " "));
      const becomes = paragraphWords(offer.becomes);
      let score = 0;
      if (offer.key === raw) score = 100;
      else if (q && (q === label || q === becomes)) score = 90;
      else if (becomes && (becomes.includes(q) || q.includes(becomes))) score = 80;
      else if (label && (q.includes(label) || label.includes(q))) score = 70;
      return { offer, score };
    })
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const next = ranked[1];
  const choices = offers
    .map((offer) => `${offer.label} → "${offer.becomes || "(removed)"}" (key ${offer.key})`)
    .join("; ");
  if (!best || best.score < 70 || (next && next.score === best.score))
    throw new ToolError(`No single paragraph matches "${query}". Changed paragraphs: ${choices || "none"}.`);
  return best.offer;
}

async function openRecord(title: string): Promise<FileRecord> {
  const id = openFileId();
  if (id) {
    const record = await storage.get(id);
    if (record?.file.kind === "doc") return record;
  }
  const matches = (await storage.list()).filter(
    (record) => record.file.kind === "doc" && record.file.title === title,
  );
  if (matches.length === 1) return (await storage.get(matches[0].file.id)) ?? matches[0];
  throw new ToolError(`Could not find the open document "${title}" on this computer.`);
}

/** Named versions of the open document, from SuiteDrive when the file lives there. */
async function namedVersionBodies(record: FileRecord): Promise<{ id: string; name: string; native: string }[]> {
  if (record.drive) {
    const list = await drive.versions(record.drive.itemId);
    const named = list.filter((item) => item.name);
    return Promise.all(
      named.map(async (item) => ({
        id: item.id,
        name: item.name!,
        native: await drive.readVersion(record.drive!.itemId, item.id),
      })),
    );
  }
  const versions = await localVersions(record.file.id);
  return versions
    .filter((item) => item.name)
    .map((item) => ({ id: item.id, name: item.name!, native: item.native }));
}

function pickNamedVersion(
  versions: { id: string; name: string; native: string }[],
  query: string,
) {
  const wanted = unwrapName(query).toLowerCase();
  const exact = versions.find((item) => item.name.toLowerCase() === wanted || item.id === query.trim());
  const contained = versions.filter((item) => wanted.includes(item.name.toLowerCase()));
  return exact ?? (contained.length === 1 ? contained[0] : undefined);
}

/**
 * Store the mixed document as a new version and show it. On SuiteDrive the
 * previous head stays in the history, and the new head is named for this paragraph.
 */
async function commitParagraphRestore(record: FileRecord, live: SuiteFile, next: SuiteFile, title: string) {
  if (record.drive) {
    let link = { ...record.drive };
    const head = await drive.read(link.itemId);
    if (head.versionId) link = { ...link, versionId: head.versionId };
    const stored = parseFile(head.text);
    if (stored.kind === "doc" && !sameJson(stored.content, live.content))
      link = await uploadDriveFile(live, link);
    link = await uploadDriveFile(next, link);
    if (link.versionId) await drive.nameVersion(link.itemId, link.versionId, title);
    return applyRestoredFile({ ...record, file: next, drive: link });
  }
  await recordLocalParagraphRestore(live, next, title);
  return applyRestoredFile({ ...record, file: next });
}

export function restoreParagraphTool(ctx: DocsAgentContext): SuiteTool {
  const { editor } = ctx;
  return tool({
    name: "restore_paragraph",
    label: "Restore one paragraph",
    description:
      'Put one paragraph from a named earlier version back into this document. Pass version as that version\'s name, such as "Agreed rota", and paragraph as the paragraph to restore: its label (north-bed), its text in the earlier version ("North bed: 6am"), or its compare key. Every other paragraph stays, including bold. This keeps the named version, records a new version for this one paragraph, and does not restore the whole document or create another file. Call it once for that paragraph, then stop. Do not use restore_version, copy_version, or write_text for this.',
    parameters: Type.Object({
      version: Type.String({ description: 'The earlier version\'s name, such as "Agreed rota".' }),
      paragraph: Type.String({
        description: 'The one paragraph to restore: "north-bed", "North bed: 6am", or its compare key.',
      }),
    }),
    prepare: (args) => ({
      version: firstString(args, ["version", "version_name", "versionName", "from", "source", "name"]),
      paragraph: firstString(args, [
        "paragraph",
        "paragraph_text",
        "paragraph_name",
        "text",
        "key",
        "block",
        "which",
        "target",
        "label",
      ]),
    }),
    target: () => document.querySelector('[aria-label="Version history"]') ?? editor.view.dom,
    async execute({ version, paragraph }) {
      try {
        const record = await openRecord(ctx.title);
        const named = await namedVersionBodies(record);
        const nameHit = (value: string) =>
          named.some((item) => {
            const name = item.name.toLowerCase();
            const q = unwrapName(value).toLowerCase();
            return q === name || (name.length > 2 && q.includes(name));
          });
        const versionQuery = !nameHit(version) && nameHit(paragraph) ? paragraph : version;
        const paragraphQuery = versionQuery === paragraph ? version : paragraph;
        const picked = pickNamedVersion(named, versionQuery);
        if (!picked)
          throw new ToolError(
            `No version named "${version}". Named versions: ${named.map((item) => item.name).join(", ") || "none"}. Call restore_paragraph with the version's name. Do not call restore_version.`,
          );
        const beforeFile = parseFile(picked.native);
        if (beforeFile.kind !== "doc" || record.file.kind !== "doc")
          throw new ToolError("Only a document can restore one paragraph.");
        const liveContent = editor.getJSON() as JsonNode;
        const live: DocFile = { ...record.file, content: liveContent, updatedAt: new Date().toISOString() };
        const offers = compareParagraphs(beforeFile.content, liveContent).offers.filter(
          (item): item is ParagraphOffer => item !== null,
        );
        const offer = pickParagraphOffer(offers, paragraphQuery);
        const content = applyParagraphRestore(liveContent, beforeFile.content, offer.key);
        const next: DocFile = { ...live, content, updatedAt: new Date().toISOString() };
        const title = partialRestoreTitle(offer.label);
        const applied = await commitParagraphRestore(record, live, next, title);
        if (!applied) editor.view.dispatch(replaceDocument(editor.state, content));
        const effect = offer.becomes ? ` It is now "${offer.becomes}".` : " It is removed.";
        return `Restored only the ${offer.label} paragraph from "${picked.name}".${effect} Every other paragraph is unchanged. "${title}" is now in the history, and "${picked.name}" is still named. The whole file was not restored and no copy was made. Stop.`;
      } catch (error) {
        if (error instanceof ToolError) throw error;
        if (error instanceof DriveConflict)
          throw new ToolError(
            "SuiteDrive has a newer version than the one open here. Call restore_paragraph again. Do not restore the whole file and do not type the paragraph in.",
          );
        throw new ToolError(error instanceof Error ? error.message : "Could not restore that paragraph.");
      }
    },
  });
}
