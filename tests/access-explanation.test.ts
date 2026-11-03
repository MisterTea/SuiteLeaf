import { describe, expect, it } from "vitest";
import { accessExplanationText } from "../apps/web/src/drive/access-explanation";

describe("access explanation", () => {
  it("names the caller's reason and leaves other grant ids out", () => {
    const text = accessExplanationText({
      role: "editor",
      reason: {
        kind: "grant",
        principalType: "group",
        principalId: "secret-group",
        itemId: "folder",
        itemName: "Beds",
        inherited: true,
      },
      folderChainTruncated: false,
      groupLoops: [],
    });
    expect(text).toBe("You have access from a group on “Beds” as an editor.");
    expect(text).not.toContain("secret-group");
    expect(text).not.toContain("folder");
    expect(
      accessExplanationText({
        role: "editor",
        reason: {
          kind: "grant",
          principalType: "group",
          principalId: "secret-value",
          itemId: "file",
          itemName: "Notes",
          inherited: false,
        },
        folderChainTruncated: false,
        groupLoops: [],
      }),
    ).toBe("You were given access through a group as an editor.");
    expect(
      accessExplanationText({
        role: "viewer",
        reason: {
          kind: "grant",
          principalType: "user",
          principalId: "secret-value",
          itemId: "file",
          itemName: "Notes",
          inherited: false,
        },
        folderChainTruncated: false,
        groupLoops: [],
      }),
    ).toBe("You were given access on this item as a viewer.");
    const unknown = accessExplanationText({
      role: "secret-value",
      reason: {
        kind: "grant",
        principalType: "user",
        principalId: "hidden",
        itemId: "file",
        itemName: "Notes",
        inherited: false,
      },
      folderChainTruncated: false,
      groupLoops: [],
    });
    expect(unknown).toBe("You were given access on this item as another role.");
    expect(unknown).not.toContain("secret-value");
    expect(
      accessExplanationText({
        role: "owner",
        reason: { kind: "owner", itemId: "file", itemName: "Notes" },
        folderChainTruncated: true,
        groupLoops: ["Garden"],
      }),
    ).toBe(
      "You own “Notes”. The folder chain was too deep to finish. A group membership cycle was found.",
    );
    expect(
      accessExplanationText({
        role: null,
        reason: { kind: "expired", principalType: "user", principalId: "hidden", itemId: "file" },
        folderChainTruncated: false,
        groupLoops: [],
      }),
    ).toBe("Your access has expired.");
    const restricted = accessExplanationText({
      role: null,
      reason: { kind: "restricted", itemId: "beds-id", itemName: "Beds" },
      folderChainTruncated: false,
      groupLoops: [],
    });
    expect(restricted).toBe(
      "“Beds” is restricted. Access from a folder above it does not apply.",
    );
    expect(restricted).not.toContain("beds-id");
    const hidden = accessExplanationText({
      role: null,
      reason: { kind: "restricted", itemId: "", itemName: "" },
      folderChainTruncated: false,
      groupLoops: [],
    });
    expect(hidden).toBe(
      "A folder above this item is restricted. Access from that folder does not apply.",
    );
    expect(hidden).not.toContain("Beds");
    const owned = accessExplanationText({
      role: "owner",
      reason: { kind: "owner", itemId: "secret-value", itemName: " " },
      folderChainTruncated: false,
      groupLoops: [],
    });
    expect(owned).toBe("You own this item.");
    expect(owned).not.toContain("secret-value");
  });
});
