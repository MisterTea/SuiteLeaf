import { describe, expect, it } from "vitest";
import JSZip from "jszip";
// @ts-expect-error The standalone audit CLI helper is JavaScript.
import { inspectPptx, comparePptxContent } from "../scripts/pptx-audit.mjs";

async function deck(text: string, notes = "", image = "original") {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", `<p:sld>${text}</p:sld>`);
  if (notes) zip.file("ppt/notesSlides/notesSlide1.xml", notes);
  zip.file("ppt/media/image1.png", image);
  return inspectPptx(await zip.generateAsync({ type: "nodebuffer" }));
}

describe("PPTX content audit", () => {
  it("ignores XML run boundaries and generated slide-number placeholders", async () => {
    const before = await deck("<a:t>A &amp; B</a:t>");
    const after = await deck(
      "<a:t>A</a:t><a:t> &amp; B</a:t>",
      '<p:sp><p:nvPr><p:ph type="sldNum"/></p:nvPr><a:t>1</a:t></p:sp>',
    );
    expect(comparePptxContent(before, after)).toMatchObject({
      changedTextSlides: [],
      missingMedia: [],
      notesEqual: true,
    });
  });

  it("detects removed speaker notes, text, and changed media bytes", async () => {
    const before = await deck(
      "<a:t>Full text</a:t>",
      '<p:sp><p:nvPr><p:ph type="body"/></p:nvPr><a:t>Speaker note</a:t></p:sp>',
    );
    const after = await deck("<a:t>Full</a:t>", "", "different");
    const comparison = comparePptxContent(before, after);
    expect(comparison.changedTextSlides).toEqual([1]);
    expect(comparison.notesEqual).toBe(false);
    expect(comparison.missingMedia).toHaveLength(1);
  });
});

it("distinguishes active layout artwork from unused packaged media", async () => {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", "<p:sld/>");
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    '<Relationships><Relationship Id="layout" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>',
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    '<p:sldLayout><a:blip r:embed="art"/></p:sldLayout>',
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    '<Relationships><Relationship Id="art" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/art.png"/></Relationships>',
  );
  zip.file("ppt/media/art.png", "active");
  zip.file("ppt/media/unused.png", "unused");
  const before = await inspectPptx(
    await zip.generateAsync({ type: "nodebuffer" }),
  );
  const after = { ...before, media: [] };
  const comparison = comparePptxContent(before, after);
  expect(
    comparison.missingReferencedMedia.map(
      (item: { name: string }) => item.name,
    ),
  ).toEqual(["ppt/media/art.png"]);
  expect(
    comparison.missingUnusedMedia.map((item: { name: string }) => item.name),
  ).toEqual(["ppt/media/unused.png"]);
});

it("excludes unused master-linked layouts and explicitly hidden footer artwork", async () => {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", "<p:sld/>");
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    '<Relationships><Relationship Id="layout" Type="x/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>',
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    '<p:sldLayout><p:sp><p:ph type="ftr"/><a:blip r:embed="footer"/></p:sp></p:sldLayout>',
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    '<Relationships><Relationship Id="master" Type="x/slideMaster" Target="../slideMasters/slideMaster1.xml"/><Relationship Id="footer" Type="x/image" Target="../media/footer.png"/></Relationships>',
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    '<p:sldMaster><p:hf ftr="0"/></p:sldMaster>',
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    '<Relationships><Relationship Id="unusedLayout" Type="x/slideLayout" Target="../slideLayouts/slideLayout2.xml"/></Relationships>',
  );
  zip.file(
    "ppt/slideLayouts/slideLayout2.xml",
    '<p:sldLayout><a:blip r:embed="unused"/></p:sldLayout>',
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout2.xml.rels",
    '<Relationships><Relationship Id="unused" Type="x/image" Target="../media/unused.png"/></Relationships>',
  );
  zip.file("ppt/media/footer.png", "hidden footer");
  zip.file("ppt/media/unused.png", "unused layout");
  const before = await inspectPptx(
    await zip.generateAsync({ type: "nodebuffer" }),
  );
  const comparison = comparePptxContent(before, { ...before, media: [] });
  expect(comparison.missingReferencedMedia).toEqual([]);
  expect(comparison.missingUnusedMedia).toHaveLength(2);
  expect(before.media[0].references[0].hiddenPlaceholder).toBe(true);
});

it("compares speaker notes by slide relationships instead of notes filenames or ZIP order", async () => {
  async function fixture(first: number, second: number) {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", "<p:sld/>");
    zip.file("ppt/slides/slide2.xml", "<p:sld/>");
    for (const [slide, note, text] of [
      [2, second, "Second notes"],
      [1, first, "First notes"],
    ] as const) {
      zip.file(
        `ppt/slides/_rels/slide${slide}.xml.rels`,
        `<Relationships><Relationship Id="note" Type="x/notesSlide" Target="../notesSlides/notesSlide${note}.xml"/></Relationships>`,
      );
      zip.file(
        `ppt/notesSlides/notesSlide${note}.xml`,
        `<p:notes><p:sp><p:ph type="body"/><a:t>${text}</a:t></p:sp></p:notes>`,
      );
    }
    return inspectPptx(await zip.generateAsync({ type: "nodebuffer" }));
  }
  const before = await fixture(7, 3);
  const after = await fixture(1, 2);
  expect(comparePptxContent(before, after).notesEqual).toBe(true);
  after.notes[0].text = "Secondnotes";
  expect(comparePptxContent(before, after).notesEqual).toBe(false);
});

it("reports lost editable object payloads even when a preview image remains", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    '<p:sld><p:oleObj r:id="editable"/><a:blip r:embed="preview"/></p:sld>',
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    '<Relationships><Relationship Id="editable" Type="x/oleObject" Target="../embeddings/object.bin"/><Relationship Id="preview" Type="x/image" Target="../media/image.png"/></Relationships>',
  );
  zip.file("ppt/media/image.png", "preview");
  zip.file("ppt/embeddings/object.bin", "editable object");
  const before = await inspectPptx(
    await zip.generateAsync({ type: "nodebuffer" }),
  );
  const after = { ...before, embeddings: 0, embeddingAssets: [] };
  const comparison = comparePptxContent(before, after);
  expect(comparison.missingMedia).toEqual([]);
  expect(
    comparison.missingReferencedEmbeddings.map(
      (item: { name: string }) => item.name,
    ),
  ).toEqual(["ppt/embeddings/object.bin"]);
});

it("uses presentation slide order rather than numeric XML filenames", async () => {
  async function deck(reversed: boolean) {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><a:t>${reversed ? "Second" : "First"}</a:t></p:sld>`,
    );
    zip.file(
      "ppt/slides/slide2.xml",
      `<p:sld><a:t>${reversed ? "First" : "Second"}</a:t></p:sld>`,
    );
    zip.file(
      "ppt/presentation.xml",
      `<p:presentation><p:sldIdLst><p:sldId r:id="${reversed ? "two" : "one"}"/><p:sldId r:id="${reversed ? "one" : "two"}"/></p:sldIdLst></p:presentation>`,
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      '<Relationships><Relationship Id="one" Type="x/slide" Target="slides/slide1.xml"/><Relationship Id="two" Type="x/slide" Target="slides/slide2.xml"/></Relationships>',
    );
    return inspectPptx(await zip.generateAsync({ type: "nodebuffer" }));
  }
  expect(
    comparePptxContent(await deck(false), await deck(true)).changedTextSlides,
  ).toEqual([]);
});
