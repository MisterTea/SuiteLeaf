import { describe, expect, it } from "vitest";
import { pickVersion, type ListedVersion } from "../apps/web/src/ai/tools/files";

function at(daysAgo: number, hour: number, minute: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const rosa: ListedVersion = {
  id: "rosa-monday",
  author: "Rosa Diaz",
  createdAt: at(1, 18, 2),
  name: null,
  current: false,
  preview:
    "Watering rota | Monday — Rosa, greenhouse, 7am | Tuesday — Sam, raised beds, 7am | Wednesday — Priya, compost, 6pm | Thursday — Leo, north fence, 7am",
};
const samEarly: ListedVersion = {
  id: "sam-0906",
  author: "Sam Okafor",
  createdAt: at(0, 9, 6),
  name: null,
  current: false,
  preview: "Watering rota | Monday — Sam, greenhouse, 7am | Tuesday — Sam, raised beds, 7am",
};
const samHead: ListedVersion = {
  id: "sam-0914",
  author: "Sam Okafor",
  createdAt: at(0, 9, 14),
  name: null,
  current: true,
  preview:
    "Watering rota | Monday — Sam, greenhouse, 6am | Tuesday — Sam, all the beds, 7am | Friday — Rosa, seed library, 8am",
};

const versions = [samHead, samEarly, rosa];

describe("pickVersion", () => {
  it("picks Rosa's yesterday evening version even when Sam's text mentions Rosa", () => {
    expect(pickVersion(versions, "Rosa Diaz").id).toBe("rosa-monday");
    expect(pickVersion(versions, "Yesterday 18:02").id).toBe("rosa-monday");
    expect(pickVersion(versions, "yesterday evening").id).toBe("rosa-monday");
  });

  it("picks Sam's 09:14 version by its time and refuses an author shared by several versions", () => {
    expect(pickVersion(versions, "Today 09:14").id).toBe("sam-0914");
    expect(pickVersion(versions, "sam-0914").id).toBe("sam-0914");
    expect(() => pickVersion(versions, "Sam Okafor")).toThrow(/No single version/);
  });
});
