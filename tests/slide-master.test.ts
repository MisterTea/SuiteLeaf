import { describe, expect, it } from "vitest";
import { createFile, parseFile, serializeFile } from "@suiteleaf/core";
import {
  addMasterImage,
  addMasterText,
  inheritedFontSize,
  inheritedText,
  readMaster,
  removeMasterElement,
  setMasterBackground,
  updateMasterElement,
} from "../apps/web/src/editors/slide-master";

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

  it("does not copy text from a decorative master object", () => {
    const master = [{ id: "master-title", placeholder: "title", content: "secret-value", decorative: true }];
    const blank = { id: "box", placeholder: "title", content: "" };
    expect(inheritedText(blank, master).content).toBeUndefined();
    expect(master[0].content).toBe("secret-value");
    expect(blank.content).toBe("");
  });
});
