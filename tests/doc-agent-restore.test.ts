// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFile, serializeFile, type FileRecord, type JsonNode, type SuiteFile } from "@suiteleaf/core";
import { docHarness, h, json, p, text, type DocHarness } from "./doc-agent-tools-fixture";
import { bindRestoredFile } from "../apps/web/src/ai/restored-file";

const store = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  localVersions: vi.fn(),
  recordLocalParagraphRestore: vi.fn(),
  versions: vi.fn(),
  readVersion: vi.fn(),
  read: vi.fn(),
  nameVersion: vi.fn(),
  uploadDriveFile: vi.fn(),
}));

vi.mock("../apps/web/src/storage", () => ({ storage: { get: store.get, list: store.list } }));
vi.mock("../apps/web/src/editors/local-versions", () => ({
  localVersions: store.localVersions,
  recordLocalParagraphRestore: store.recordLocalParagraphRestore,
}));
vi.mock("../apps/web/src/node-client", async (load) => ({
  ...(await load<typeof import("../apps/web/src/node-client")>()),
  drive: { versions: store.versions, readVersion: store.readVersion, read: store.read, nameVersion: store.nameVersion },
  uploadDriveFile: store.uploadDriveFile,
}));

const { DriveConflict } = await import("../apps/web/src/node-client");

let d: DocHarness | undefined;
afterEach(() => {
  d?.destroy();
  d = undefined;
  bindRestoredFile(null);
  history.replaceState(null, "", "/");
});
beforeEach(() => {
  for (const fn of Object.values(store)) fn.mockReset();
});

const rota = () => [h(1, "Watering rota"), p("North bed: 8am"), p(text("South bed: 7am", ["bold"])), p("Thursday: ask Alex to cover.")];
const agreed = { type: "doc", content: [h(1, "Watering rota"), p("North bed: 6am"), p("South bed: 7am")] } as JsonNode;

function docFile(content: JsonNode, title = "Rota"): SuiteFile {
  return { ...createFile("doc", title), content } as SuiteFile;
}

function openRota(record: Partial<FileRecord> = {}) {
  d = docHarness(rota(), { title: "Rota" });
  const file = docFile(d.editor.getJSON() as JsonNode);
  const full: FileRecord = { file, ...record };
  store.list.mockResolvedValue([full]);
  store.get.mockResolvedValue(full);
  return { doc: d, record: full };
}

const versionsWith = (...items: { id: string; name?: string; native: string }[]) => store.localVersions.mockResolvedValue(items);
const paragraphs = (doc: DocHarness) => (json(doc.editor).content ?? []).map((n) => n.content?.map((c) => c.text).join("") ?? "");

describe("restore_paragraph on this computer", () => {
  it("reads its arguments under several names", () => {
    const doc = docHarness([p("x")]);
    expect(doc.tool("restore_paragraph").prepare!({ version_name: " Agreed rota ", label: "north-bed" })).toEqual({
      version: "Agreed rota",
      paragraph: "north-bed",
    });
    doc.destroy();
  });

  it("puts one paragraph back from a named version and records the restore", async () => {
    const { doc, record } = openRota();
    versionsWith({ id: "v2", native: "unused" }, { id: "v1", name: "Agreed rota", native: serializeFile(docFile(agreed)) });
    const out = await doc.run("restore_paragraph", { version: '"Agreed rota"', paragraph: "North bed: 6am" });
    expect(out).toBe(
      'Restored only the north-bed paragraph from "Agreed rota". It is now "North bed: 6am". Every other paragraph is unchanged. "Restored the north-bed paragraph" is now in the history, and "Agreed rota" is still named. The whole file was not restored and no copy was made. Stop.',
    );
    expect(paragraphs(doc)).toEqual(["Watering rota", "North bed: 6am", "South bed: 7am", "Thursday: ask Alex to cover."]);
    expect(doc.editor.getJSON().content?.[2].content?.[0].marks).toEqual([{ type: "bold" }]);
    expect(store.localVersions).toHaveBeenCalledWith(record.file.id);
    const [live, next, title] = store.recordLocalParagraphRestore.mock.calls[0];
    expect(title).toBe("Restored the north-bed paragraph");
    expect(JSON.stringify(live.content)).toContain("North bed: 8am");
    expect(JSON.stringify(next.content)).toContain("North bed: 6am");
  });

  it("hands the restored file to the open editor when one is listening, and reads swapped arguments", async () => {
    const { doc } = openRota();
    history.replaceState(null, "", "/#/file/abc");
    versionsWith({ id: "v1", name: "Agreed rota", native: serializeFile(docFile(agreed)) });
    const apply = vi.fn();
    bindRestoredFile(apply);
    const out = await doc.run("restore_paragraph", { version: "thursday", paragraph: "the Agreed rota version" });
    expect(out).toContain('Restored only the thursday paragraph from "Agreed rota". It is removed.');
    expect(store.get).toHaveBeenCalledWith("abc");
    expect(apply).toHaveBeenCalledOnce();
    expect(JSON.stringify(apply.mock.calls[0][0].file.content)).not.toContain("Thursday");
    expect(paragraphs(doc)).toContain("Thursday: ask Alex to cover.");
  });

  it("names the versions and paragraphs it can restore when the call does not match one", async () => {
    const { doc } = openRota();
    versionsWith({ id: "v1", name: "Agreed rota", native: serializeFile(docFile(agreed)) });
    await expect(doc.run("restore_paragraph", { version: "Monday", paragraph: "north-bed" })).rejects.toThrow(
      /No version named "Monday". Named versions: Agreed rota./,
    );
    await expect(doc.run("restore_paragraph", { version: "Agreed rota", paragraph: "everything" })).rejects.toThrow(
      /Name the one paragraph to restore/,
    );
    await expect(doc.run("restore_paragraph", { version: "Agreed rota", paragraph: "compost" })).rejects.toThrow(
      /No single paragraph matches "compost". Changed paragraphs: north-bed → "North bed: 6am" \(key replace:1\); thursday → "\(removed\)"/,
    );
    expect(await doc.run("restore_paragraph", { version: "v1", paragraph: "replace:1" })).toContain("north-bed paragraph");
    expect(store.recordLocalParagraphRestore).toHaveBeenCalledOnce();
  });

  it("refuses a version that is not a document, and a file it cannot find", async () => {
    const { doc } = openRota();
    versionsWith({ id: "v1", name: "Agreed rota", native: serializeFile(createFile("sheet", "Rota")) });
    await expect(doc.run("restore_paragraph", { version: "Agreed rota", paragraph: "north-bed" })).rejects.toThrow(
      /Only a document can restore one paragraph/,
    );
    store.list.mockResolvedValue([]);
    store.get.mockResolvedValue(undefined);
    history.replaceState(null, "", "/#/file/missing");
    await expect(doc.run("restore_paragraph", { version: "Agreed rota", paragraph: "north-bed" })).rejects.toThrow(
      /Could not find the open document "Rota" on this computer/,
    );
  });

  it("reports an unexpected failure as a tool error", async () => {
    const { doc } = openRota();
    store.localVersions.mockRejectedValue(new Error("Database closed"));
    await expect(doc.run("restore_paragraph", { version: "Agreed rota", paragraph: "north-bed" })).rejects.toThrow(/^Database closed$/);
    store.localVersions.mockRejectedValue("odd");
    await expect(doc.run("restore_paragraph", { version: "Agreed rota", paragraph: "north-bed" })).rejects.toThrow(
      /^Could not restore that paragraph.$/,
    );
  });
});

describe("restore_paragraph on SuiteDrive", () => {
  const link = { itemId: "item-1", versionId: "head-0" };

  it("saves the open text first when the head differs, then names the restore", async () => {
    const { doc } = openRota({ drive: link } as Partial<FileRecord>);
    store.versions.mockResolvedValue([{ id: "dv1", name: "Agreed rota" }, { id: "dv2" }]);
    store.readVersion.mockResolvedValue(serializeFile(docFile(agreed)));
    store.read.mockResolvedValue({ versionId: "head-1", text: serializeFile(docFile(agreed)) });
    store.uploadDriveFile.mockImplementationOnce(async (_file, l) => ({ ...l, versionId: "head-2" }));
    store.uploadDriveFile.mockImplementationOnce(async (_file, l) => ({ ...l, versionId: "head-3" }));
    const out = await doc.run("restore_paragraph", { version: "Agreed rota", paragraph: "north-bed" });
    expect(out).toContain('Restored only the north-bed paragraph from "Agreed rota".');
    expect(store.readVersion).toHaveBeenCalledWith("item-1", "dv1");
    expect(store.readVersion).toHaveBeenCalledOnce();
    expect(store.uploadDriveFile).toHaveBeenCalledTimes(2);
    expect(store.uploadDriveFile.mock.calls[0][1]).toEqual({ itemId: "item-1", versionId: "head-1" });
    expect(JSON.stringify(store.uploadDriveFile.mock.calls[1][0].content)).toContain("North bed: 6am");
    expect(store.nameVersion).toHaveBeenCalledWith("item-1", "head-3", "Restored the north-bed paragraph");
    expect(store.recordLocalParagraphRestore).not.toHaveBeenCalled();
  });

  it("uploads once when the head already matches, and asks to retry on a conflict", async () => {
    const { doc } = openRota({ drive: link } as Partial<FileRecord>);
    store.versions.mockResolvedValue([{ id: "dv1", name: "Agreed rota" }]);
    store.readVersion.mockResolvedValue(serializeFile(docFile(agreed)));
    store.read.mockResolvedValue({ text: serializeFile(docFile(doc.editor.getJSON() as JsonNode)) });
    store.uploadDriveFile.mockResolvedValueOnce({ itemId: "item-1" });
    await doc.run("restore_paragraph", { version: "Agreed rota", paragraph: "north-bed" });
    expect(store.uploadDriveFile).toHaveBeenCalledOnce();
    expect(store.nameVersion).not.toHaveBeenCalled();
    store.uploadDriveFile.mockRejectedValueOnce(new DriveConflict({} as never));
    await expect(doc.run("restore_paragraph", { version: "Agreed rota", paragraph: "thursday" })).rejects.toThrow(
      /SuiteDrive has a newer version than the one open here/,
    );
  });
});
