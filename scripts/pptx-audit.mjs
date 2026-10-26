import JSZip from "jszip";
import { createHash } from "node:crypto";
import { posix } from "node:path";

const decode = (value) =>
  value
    .replace(/&#x([\da-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
const texts = (xml) =>
  [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
    .map((m) => decode(m[1]))
    .join("")
    .replace(/\s+/gu, "");

/** Inspect content independently of SuiteLeaf's importer, validating ZIP CRCs. */
export async function inspectPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  let slides = names
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(
      (a, b) =>
        Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]),
    );
  const presentation = zip.file("ppt/presentation.xml");
  const presentationRelations = zip.file("ppt/_rels/presentation.xml.rels");
  if (presentation && presentationRelations) {
    const targets = new Map(
      [
        ...(await presentationRelations.async("string")).matchAll(
          /<Relationship\b([^>]*)\/?>/g,
        ),
      ].map((match) => {
        const attrs = Object.fromEntries(
          [...match[1].matchAll(/([\w:]+)="([^"]*)"/g)].map((attribute) => [
            attribute[1],
            decode(attribute[2]),
          ]),
        );
        return [
          attrs.Id,
          attrs.Target?.startsWith("/")
            ? attrs.Target.slice(1)
            : posix.normalize(posix.join("ppt", attrs.Target || "")),
        ];
      }),
    );
    const ordered = [
      ...(await presentation.async("string")).matchAll(
        /<p:sldId\b[^>]*r:id="([^"]*)"[^>]*\/?>/g,
      ),
    ]
      .map((match) => targets.get(match[1]))
      .filter((name) => name && zip.file(name));
    if (ordered.length) slides = ordered;
  }
  const result = {
    slides: [],
    media: [],
    embeddingAssets: [],
    notes: [],
    tables: 0,
    charts: 0,
    embeddings: names.filter((name) => /^ppt\/(?:.*\/)?embeddings\//.test(name))
      .length,
  };
  for (const name of slides) {
    const xml = await zip.file(name).async("string");
    result.slides.push(texts(xml));
    result.tables += (xml.match(/<a:tbl\b/g) || []).length;
    result.charts += (xml.match(/<c:chart\b/g) || []).length;
  }
  const references = new Map();
  const ancestry = new Set(slides);
  const partRelations = new Map();
  const partXml = new Map();
  for (const name of names.filter(
    (name) => name.endsWith(".rels") && name.includes("/_rels/"),
  )) {
    const owner = name.replace("/_rels/", "/").replace(/\.rels$/, "");
    const ownerFile = zip.file(owner);
    if (!ownerFile) continue;
    const ownerXml = await ownerFile.async("string");
    partXml.set(owner, ownerXml);
    const relXml = await zip.file(name).async("string");
    const rels = [...relXml.matchAll(/<Relationship\b([^>]*)\/?>/g)].map(
      (match) =>
        Object.fromEntries(
          [...match[1].matchAll(/([\w:]+)="([^"]*)"/g)].map((attribute) => [
            attribute[1],
            decode(attribute[2]),
          ]),
        ),
    );
    partRelations.set(owner, rels);
    for (const rel of rels) {
      if (rel.TargetMode === "External" || !rel.Target) continue;
      const target = rel.Target.startsWith("/")
        ? rel.Target.slice(1)
        : posix.normalize(posix.join(posix.dirname(owner), rel.Target));
      if (!/^ppt\/(?:.*\/)?(?:media|embeddings)\//.test(target)) continue;
      const mentioned = [
        ...ownerXml.matchAll(/r:(?:embed|link|id)="([^"]*)"/g),
      ].some((match) => match[1] === rel.Id);
      if (!mentioned) continue;
      const role = owner.startsWith("ppt/slides/")
        ? "slide"
        : owner.startsWith("ppt/slideLayouts/")
          ? "layout"
          : owner.startsWith("ppt/slideMasters/")
            ? "master"
            : "other";
      if (!references.has(target)) references.set(target, []);
      const shape = [...ownerXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].find(
        (match) =>
          [...match[0].matchAll(/r:(?:embed|link|id)="([^"]*)"/g)].some(
            (attribute) => attribute[1] === rel.Id,
          ),
      );
      const placeholderType = shape
        ? /<p:ph\b[^>]*type="([^"]*)"/.exec(shape[0])?.[1]
        : undefined;
      references
        .get(target)
        .push({ owner, role, ...(placeholderType ? { placeholderType } : {}) });
    }
  }
  for (const owner of ancestry) {
    for (const rel of partRelations.get(owner) || []) {
      const expectedType = owner.startsWith("ppt/slides/")
        ? "slideLayout"
        : owner.startsWith("ppt/slideLayouts/")
          ? "slideMaster"
          : null;
      if (!expectedType || !rel.Type?.endsWith(`/${expectedType}`)) continue;
      const target = rel.Target.startsWith("/")
        ? rel.Target.slice(1)
        : posix.normalize(posix.join(posix.dirname(owner), rel.Target));
      ancestry.add(target);
    }
  }
  const hiddenPlaceholder = (owner, type, visited = new Set()) => {
    if (!/^(ftr|hdr|dt|sldNum)$/.test(type || "") || visited.has(owner))
      return false;
    visited.add(owner);
    const flag = new RegExp(`<p:hf\\b[^>]*\\b${type}="([^\"]*)"`).exec(
      partXml.get(owner) || "",
    )?.[1];
    if (flag !== undefined) return flag === "0" || flag === "false";
    const parent = (partRelations.get(owner) || []).find((rel) =>
      rel.Type?.endsWith("/slideMaster"),
    );
    if (!parent) return false;
    return hiddenPlaceholder(
      posix.normalize(posix.join(posix.dirname(owner), parent.Target)),
      type,
      visited,
    );
  };
  for (const name of names.filter((name) =>
    /^ppt\/(?:.*\/)?media\//.test(name),
  )) {
    const bytes = await zip.file(name).async("nodebuffer");
    result.media.push({
      name,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      references: (references.get(name) || []).map((reference) => ({
        ...reference,
        activePart: ancestry.has(reference.owner),
        hiddenPlaceholder:
          reference.role !== "slide" &&
          hiddenPlaceholder(reference.owner, reference.placeholderType),
      })),
    });
  }
  for (const name of names.filter((name) =>
    /^ppt\/(?:.*\/)?embeddings\//.test(name),
  )) {
    result.embeddingAssets.push({
      name,
      sha256: createHash("sha256")
        .update(await zip.file(name).async("nodebuffer"))
        .digest("hex"),
      references: (references.get(name) || []).map((reference) => ({
        ...reference,
        activePart: ancestry.has(reference.owner),
      })),
    });
  }
  for (let index = 0; index < slides.length; index++) {
    const slidePath = slides[index];
    const relation = (partRelations.get(slidePath) || []).find((rel) =>
      rel.Type?.endsWith("/notesSlide"),
    );
    const name = relation
      ? relation.Target.startsWith("/")
        ? relation.Target.slice(1)
        : posix.normalize(posix.join(posix.dirname(slidePath), relation.Target))
      : !partRelations.has(slidePath)
        ? `ppt/notesSlides/notesSlide${index + 1}.xml`
        : "";
    const noteFile = name ? zip.file(name) : null;
    const noteXml = noteFile ? await noteFile.async("string") : "";
    // Follow each slide's relationship: notes filenames need not match slide numbers.
    const body = [...noteXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)]
      .filter(
        (match) =>
          !/<p:ph\b[^>]*type="(?:sldNum|hdr|ftr|dt|sldImg)"/.test(match[0]),
      )
      .map((match) => texts(match[0]))
      .join("");
    result.notes.push({
      slide: index + 1,
      name: noteFile ? name : null,
      text: body,
    });
  }
  return result;
}

export function comparePptxContent(before, after) {
  return {
    slideCountEqual: before.slides.length === after.slides.length,
    changedTextSlides: before.slides.flatMap((text, i) =>
      text === after.slides[i] ? [] : [i + 1],
    ),
    missingMedia: before.media.filter(
      (item) => !after.media.some((other) => item.sha256 === other.sha256),
    ),
    missingReferencedMedia: before.media.filter(
      (item) =>
        item.references?.some(
          (reference) => reference.activePart && !reference.hiddenPlaceholder,
        ) && !after.media.some((other) => item.sha256 === other.sha256),
    ),
    missingUnusedMedia: before.media.filter(
      (item) =>
        !item.references?.some(
          (reference) => reference.activePart && !reference.hiddenPlaceholder,
        ) && !after.media.some((other) => item.sha256 === other.sha256),
    ),
    notesEqual:
      JSON.stringify(before.notes.map((note) => note.text)) ===
      JSON.stringify(after.notes.map((note) => note.text)),
    tablesEqual: before.tables === after.tables,
    chartsEqual: before.charts === after.charts,
    embeddingsEqual: before.embeddings === after.embeddings,
    missingReferencedEmbeddings: (before.embeddingAssets || []).filter(
      (item) =>
        item.references.some((reference) => reference.activePart) &&
        !(after.embeddingAssets || []).some(
          (other) => item.sha256 === other.sha256,
        ),
    ),
    missingUnusedEmbeddings: (before.embeddingAssets || []).filter(
      (item) =>
        !item.references.some((reference) => reference.activePart) &&
        !(after.embeddingAssets || []).some(
          (other) => item.sha256 === other.sha256,
        ),
    ),
  };
}
