import { describe, expect, it } from "vitest";
import { createFile, parseFile, serializeFile } from "@suiteleaf/core";
import {
  addMasterImage,
  addMasterText,
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
});
