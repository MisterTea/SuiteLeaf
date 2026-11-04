// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accessLabel,
  asGrantRole,
  defaultGrantRole,
  grantRolesFor,
  roleDescription,
  roleVerb,
} from "../apps/web/src/drive/roles";
import {
  accessExplanationText,
  type AccessExplanation,
} from "../apps/web/src/drive/access-explanation";
import {
  calendarDaysBetween,
  endedPhrase,
  expiryInstant,
  monthGrid,
  untilPhrase,
} from "../apps/web/src/drive/share-expiry";
import { shareChangePreview } from "../apps/web/src/drive/share-change";
import {
  DRIVE_SAVED,
  lastEditLine,
  lastEditOf,
  requestLastEditRefresh,
  rowEditLabel,
} from "../apps/web/src/drive/last-edit";

afterEach(() => vi.unstubAllGlobals());

describe("share roles", () => {
  it("offers Responder only on forms, and starts a form share there", () => {
    expect(grantRolesFor("form").map((r) => r.id)).toEqual([
      "responder",
      "viewer",
      "commenter",
      "editor",
    ]);
    expect(grantRolesFor("doc").map((r) => r.id)).toEqual(["viewer", "commenter", "editor"]);
    expect(defaultGrantRole("form")).toBe("responder");
    expect(defaultGrantRole("sheet")).toBe("editor");
  });

  it("treats an owner as an editor when picking a grant role", () => {
    expect(asGrantRole("owner")).toBe("editor");
    expect(asGrantRole("viewer")).toBe("viewer");
  });

  it("says what each role can do", () => {
    expect(roleVerb("responder")).toBe("respond");
    expect(roleVerb("viewer")).toBe("view");
    expect(roleVerb("commenter")).toBe("comment");
    expect(roleVerb("editor")).toBe("edit");
    expect(roleDescription("commenter")).toBe("Can read and comment");
    expect(roleDescription("unknown" as never)).toBe("");
  });

  it("labels a shared file by the access it gives", () => {
    expect(accessLabel("owner")).toBe("Owner");
    expect(accessLabel("editor")).toBe("Can edit");
    expect(accessLabel("responder")).toBe("Can respond");
    expect(accessLabel("commenter")).toBe("Can comment");
    expect(accessLabel("viewer")).toBe("Can view");
    expect(accessLabel(null)).toBe("");
  });
});

describe("access explanation", () => {
  const grant = (
    principalType: string,
    inherited: boolean,
    itemName: string,
    role: string | null = "viewer",
  ): AccessExplanation => ({
    role,
    reason: { kind: "grant", principalType, principalId: "g1", itemId: "i1", itemName, inherited },
    folderChainTruncated: false,
    groupLoops: [],
  });

  it("explains every way access can come from a grant", () => {
    expect(accessExplanationText(grant("group", true, ""))).toBe(
      "You have access from a group as a viewer.",
    );
    expect(accessExplanationText(grant("group", false, "Beds"))).toBe(
      "You were given access through a group as a viewer.",
    );
    expect(accessExplanationText(grant("org", true, "Plots"))).toBe(
      "You have access from your organization on “Plots” as a viewer.",
    );
    expect(accessExplanationText(grant("org", true, " "))).toBe(
      "You have access from your organization as a viewer.",
    );
    expect(accessExplanationText(grant("org", false, "Plots", "editor"))).toBe(
      "You were given access through your organization as an editor.",
    );
    expect(accessExplanationText(grant("user", true, "Plots"))).toBe(
      "You have access from “Plots” as a viewer.",
    );
    expect(accessExplanationText(grant("user", true, ""))).toBe(
      "You have access on this item as a viewer.",
    );
    expect(accessExplanationText(grant("user", false, "", "custom-role"))).toBe(
      "You were given access on this item as another role.",
    );
    expect(accessExplanationText(grant("user", false, "", null))).toBe(
      "You were given access on this item.",
    );
  });

  it("explains owners, admins, expiry, restriction and no access", () => {
    const base = { role: null, folderChainTruncated: false, groupLoops: [] };
    expect(accessExplanationText({ ...base, reason: { kind: "admin" } })).toBe(
      "You can open this because you are an administrator.",
    );
    expect(
      accessExplanationText({ ...base, reason: { kind: "owner", itemId: "i", itemName: "" } }),
    ).toBe("You own this item.");
    expect(
      accessExplanationText({
        ...base,
        reason: { kind: "expired", principalType: "user", principalId: "p", itemId: "i" },
      }),
    ).toBe("Your access has expired.");
    expect(
      accessExplanationText({
        ...base,
        reason: { kind: "restricted", itemId: "i", itemName: "Private" },
      }),
    ).toBe("“Private” is restricted. Access from a folder above it does not apply.");
    expect(
      accessExplanationText({ ...base, reason: { kind: "restricted", itemId: "i", itemName: "" } }),
    ).toBe("A folder above this item is restricted. Access from that folder does not apply.");
    expect(
      accessExplanationText({
        ...base,
        reason: { kind: "none" },
        folderChainTruncated: true,
        groupLoops: ["a"],
      }),
    ).toBe(
      "You do not have access. The folder chain was too deep to finish. A group membership cycle was found.",
    );
  });
});

describe("share expiry calendar", () => {
  const monday = new Date(2026, 9, 12, 15, 0, 0);

  it("counts calendar days, not hours", () => {
    expect(calendarDaysBetween(new Date(2026, 9, 12, 23, 59), new Date(2026, 9, 13, 0, 1))).toBe(1);
    expect(expiryInstant(new Date(2026, 9, 17, 18, 30))).toBe(new Date(2026, 9, 17).toISOString());
  });

  it("names today, a far day, and an unreadable day", () => {
    expect(untilPhrase(new Date(2026, 9, 12, 20).toISOString(), monday)).toBe("until today");
    const far = new Date(2026, 10, 30);
    expect(untilPhrase(far.toISOString(), monday)).toBe(
      `until ${far.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
    );
    expect(untilPhrase("not a date", monday)).toBe("until that day");
  });

  it("names a long-past end by date, and an unreadable one plainly", () => {
    const past = new Date(2026, 8, 1);
    expect(endedPhrase(past.toISOString(), monday)).toBe(
      `Access ended ${past.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
    );
    expect(endedPhrase("nope", monday)).toBe("Access ended");
  });

  it("lays out six Sunday-first weeks and disables days up to today", () => {
    const days = monthGrid(new Date(2026, 9, 20), monday);
    expect(days).toHaveLength(42);
    // October 2026 starts on a Thursday, so the grid opens on Sunday, September 27.
    expect(days[0]).toMatchObject({ number: 27, inMonth: false, disabled: true });
    expect(days[0]?.label.startsWith("Sunday, ")).toBe(true);
    const twelfth = days.find((day) => day.inMonth && day.number === 12)!;
    const thirteenth = days.find((day) => day.inMonth && day.number === 13)!;
    expect(twelfth.disabled).toBe(true);
    expect(thirteenth.disabled).toBe(false);
    expect(thirteenth.iso).toBe(new Date(2026, 9, 13).toISOString());
    expect(days.filter((day) => day.inMonth)).toHaveLength(31);
  });
});

describe("share change and last edit", () => {
  it("says when a change keeps the same access", () => {
    expect(shareChangePreview({ name: "Priya", fromRole: "editor", toRole: "editor" })).toEqual({
      note: "This does not change Priya's access.",
      changes: false,
    });
    expect(shareChangePreview({ name: "x".repeat(81), fromRole: null, toRole: "viewer" }).note).toBe(
      "Someone would gain viewer access.",
    );
  });

  it("announces a SuiteDrive save to open lists", () => {
    const heard = vi.fn();
    window.addEventListener(DRIVE_SAVED, heard);
    requestLastEditRefresh();
    window.removeEventListener(DRIVE_SAVED, heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("reads the head author and says who edited last", () => {
    expect(lastEditOf({ kind: "folder", lastAuthorName: "Sam", lastEditedAt: "x" })).toBeNull();
    expect(lastEditOf({ kind: "file", lastAuthorName: " ", lastEditedAt: "x" })).toBeNull();
    const edit = lastEditOf({
      kind: "file",
      lastAuthorName: " Sam Okafor ",
      lastEditedAt: "2026-10-12T09:14:00.000Z",
    })!;
    expect(edit.name).toBe("Sam Okafor");
    const now = new Date("2026-10-12T12:00:00.000Z");
    expect(lastEditLine(edit, now).startsWith("Last edited by Sam Okafor · ")).toBe(true);
    expect(rowEditLabel(edit, now).startsWith("Sam Okafor · ")).toBe(true);
  });
});
