import { describe, expect, it } from "vitest";
import {
  shareArrivalText,
  sharedFileTitle,
} from "../apps/web/src/drive/share-notices";

describe("share notices", () => {
  it("names the sharer, the file, and the role without an extension", () => {
    expect(sharedFileTitle("Watering rota.sldoc")).toBe("Watering rota");
    expect(sharedFileTitle("Plot assignments.slsheet")).toBe("Plot assignments");
    expect(shareArrivalText("Rosa Diaz", "Watering rota", "editor")).toBe(
      "Rosa Diaz shared “Watering rota” with you · Can edit",
    );
    expect(shareArrivalText("Rosa Diaz", "Plot assignments", "viewer")).toBe(
      "Rosa Diaz shared “Plot assignments” with you · Can view",
    );
    expect(shareArrivalText("  ", "Notes", "commenter")).toBe(
      "Someone shared “Notes” with you · Can comment",
    );
  });
});
