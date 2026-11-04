import { describe, expect, it } from "vitest";
import { formUploadAnswer, formUploadText } from "../apps/web/src/form-upload";

describe("form upload", () => {
  it("keeps an allowed file name and refuses the rest", () => {
    expect(formUploadText("Beds.png", 12)).toEqual({ text: "Beds.png (12 bytes)" });
    expect(formUploadText("folder/Beds.png", 12)).toEqual({ message: "That file is not an allowed upload." });
    expect(formUploadText("../Beds.png", 12).message).toBe("That file is not an allowed upload.");
    expect(formUploadText("secret-value.png", 12).message).toBe("That file is not an allowed upload.");
    expect(formUploadText("Beds.html", 12).message).toBe("That file is not an allowed upload.");
    expect(formUploadText(".", 12).message).toBe("That file is not an allowed upload.");
    expect(formUploadText("..", 12).message).toBe("That file is not an allowed upload.");
    expect(formUploadText("Beds", 12).message).toBe("That file is not an allowed upload.");
    expect(formUploadText("Beds.png", 0).message).toBe("That file is too large.");
    expect(formUploadText("Beds.png", 5_000_001).message).toBe("That file is too large.");
    expect(formUploadText("Beds.png", 1.5).message).toBe("That file is too large.");
    expect(formUploadAnswer("Beds.pdf|20")).toEqual({ text: "Beds.pdf (20 bytes)" });
    expect(formUploadAnswer("Beds.png").message).toBe("That file is not an allowed upload.");
    expect(JSON.stringify(formUploadText("secret-value.png", 12))).not.toContain("secret-value");
  });
});
