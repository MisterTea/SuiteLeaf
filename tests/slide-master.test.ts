import { describe, expect, it } from "vitest";
import { createFile, parseFile, serializeFile } from "@suiteleaf/core";
import {
  addMasterImage,
  addMasterText,
  inheritedFontSize,
  inheritedText,
  deckMasters,
  readMaster,
  removeMasterElement,
  setMasterBackground,
  updateMasterElement,
  writeMasters,
} from "../apps/web/src/editors/slide-master";
import { newSlide } from "../apps/web/src/editors/slide-layouts";
import { attachMasterPages, materializeMasterView } from "../apps/web/src/editors/slide-master-view";

describe("slide master", () => {
  it("stores a footer and background and drops them when the master is empty", () => {
    const file = createFile("slide", "Pitch");
    if (file.kind !== "slide") throw new Error("expected slides");
    const withFooter = addMasterText(file.content, "Garden club");
    const colored = setMasterBackground(withFooter, "#eef2ff");
    expect(readMaster(colored).elements).toHaveLength(1);
    expect(readMaster(colored).elements[0]?.content).toBe("Garden club");
    expect(colored.master?.background?.color).toBe("#eef2ff");
    const saved = parseFile(serializeFile({ ...file, content: colored }));
    if (saved.kind !== "slide") throw new Error("expected slides");
    expect(saved.content.master?.elements[0]?.content).toBe("Garden club");
    const id = readMaster(colored).elements[0]!.id;
    const cleared = removeMasterElement(setMasterBackground(colored, ""), id);
    expect(cleared.master).toBeUndefined();
  });

  it("places a logo and lets its description change", () => {
    const file = createFile("slide", "Pitch");
    if (file.kind !== "slide") throw new Error("expected slides");
    const src = "data:image/png;base64,aaaa";
    const withLogo = addMasterImage(file.content, src);
    const logo = readMaster(withLogo).elements[0]!;
    expect(logo.type).toBe("image");
    expect(logo.src).toBe(src);
    const renamed = updateMasterElement(withLogo, logo.id, { alt: "Club mark" });
    expect(readMaster(renamed).elements[0]?.alt).toBe("Club mark");
  });

  it("copies a master font size and keeps a slide override", () => {
    const master = [{ id: "title", placeholder: "title", fontSize: 32 }];
    const slide = { id: "title", placeholder: "title" };
    const override = { id: "title", placeholder: "title", fontSize: 14 };
    expect(inheritedFontSize(slide, master)).toBe(32);
    expect(inheritedFontSize(override, [{ ...master[0], fontSize: 28 }])).toBe(14);
    expect(slide.fontSize).toBeUndefined();
    expect(master[0].fontSize).toBe(32);
  });

  it("copies a master color and font and keeps a slide override", () => {
    const master = [{ id: "title", placeholder: "title", color: "#112233", fontFamily: "Georgia" }];
    const slide = { id: "box", placeholder: "title" };
    const override = { id: "box", placeholder: "title", color: "#000000", fontFamily: "Arial" };
    expect(inheritedText(slide, master)).toMatchObject({ color: "#112233", fontFamily: "Georgia" });
    expect(inheritedText(slide, [{ ...master[0], color: "#445566", fontFamily: "Verdana" }])).toMatchObject({
      color: "#445566",
      fontFamily: "Verdana",
    });
    expect(inheritedText(override, [{ ...master[0], color: "#445566" }])).toMatchObject({
      color: "#000000",
      fontFamily: "Arial",
    });
    expect(slide.color).toBeUndefined();
    expect(master[0].color).toBe("#112233");
  });

  it("copies master text onto a blank placeholder and keeps typed text", () => {
    const master = [{ id: "master-title", placeholder: "title", content: "Garden club" }];
    const blank = { id: "box", placeholder: "title", content: "" };
    const typed = { id: "box", placeholder: "title", content: "North" };
    expect(inheritedText(blank, master).content).toBe("Garden club");
    expect(inheritedText(blank, [{ ...master[0], content: "Paths" }]).content).toBe("Paths");
    expect(inheritedText(typed, [{ ...master[0], content: "secret-value" }]).content).toBe("North");
    expect(blank.content).toBe("");
    expect(master[0].content).toBe("Garden club");
  });

  it("edits the master and a layout, and leaves a moved placeholder alone", () => {
    const file = createFile("slide", "Pitch");
    if (file.kind !== "slide") throw new Error("expected slides");
    const followed = newSlide("title");
    followed.elements[0] = { ...followed.elements[0]!, content: "North" };
    const custom = newSlide("title");
    custom.elements[0] = { ...custom.elements[0]!, y: 10 };
    file.content.slides = { [followed.id]: followed, [custom.id]: custom };
    file.content.slideOrder = [followed.id, custom.id];
    const opened = attachMasterPages(file.content);
    expect(JSON.stringify(materializeMasterView(opened))).toBe(JSON.stringify(file.content));
    const title = opened.slides["suiteleaf-layout-title"]!;
    const moved = {
      ...opened,
      slides: {
        ...opened.slides,
        "suiteleaf-master": {
          ...opened.slides["suiteleaf-master"]!,
          elements: [
            {
              id: "footer",
              type: "text" as const,
              x: 40,
              y: 500,
              width: 200,
              height: 24,
              content: "Garden club",
            },
          ],
        },
        "suiteleaf-layout-title": {
          ...title,
          elements: title.elements.map((el, index) => (index === 0 ? { ...el, y: el.y + 20 } : el)),
        },
      },
    };
    const saved = materializeMasterView(moved);
    expect(saved.master?.elements[0]?.content).toBe("Garden club");
    expect(saved.master?.layouts?.find((layout) => layout.name === "title")?.elements[0]?.y).toBe(
      title.elements[0]!.y + 20,
    );
    expect(saved.slides[followed.id]?.elements[0]?.y).toBe(title.elements[0]!.y + 20);
    expect(saved.slides[followed.id]?.elements[0]?.content).toBe("North");
    expect(saved.slides[custom.id]?.elements[0]?.y).toBe(10);
    const stored = parseFile(serializeFile({ ...file, content: saved }));
    if (stored.kind !== "slide") throw new Error("expected slides");
    expect(stored.content.master?.layouts?.find((layout) => layout.name === "title")?.elements[0]?.y).toBe(
      title.elements[0]!.y + 20,
    );
  });

  it("keeps a second master when the first one is edited", () => {
    const file = createFile("slide", "Pitch");
    if (file.kind !== "slide") throw new Error("expected slides");
    const first = setMasterBackground(file.content, "#eef2ff");
    const two = writeMasters(first, [
      ...deckMasters(first),
      { id: "second", name: "Master 2", elements: [], background: { color: "#111111" } },
    ]);
    expect(two.master?.background?.color).toBe("#eef2ff");
    expect(two.masters).toHaveLength(2);
    const opened = attachMasterPages(two, "second");
    const edited = {
      ...opened,
      slides: {
        ...opened.slides,
        "suiteleaf-master": {
          ...opened.slides["suiteleaf-master"]!,
          background: { color: "#222222" },
        },
      },
    };
    const saved = materializeMasterView(edited, "second");
    expect(saved.master?.background?.color).toBe("#eef2ff");
    expect(saved.masters?.[1]?.background?.color).toBe("#222222");
    expect(saved.slides["suiteleaf-master"]).toBeUndefined();
  });

  it("does not copy text from a decorative master object", () => {
    const master = [{ id: "master-title", placeholder: "title", content: "secret-value", decorative: true }];
    const blank = { id: "box", placeholder: "title", content: "" };
    expect(inheritedText(blank, master).content).toBeUndefined();
    expect(master[0].content).toBe("secret-value");
    expect(blank.content).toBe("");
  });
});
