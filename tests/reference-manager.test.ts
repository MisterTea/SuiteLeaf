import { describe, expect, it } from "vitest";
import { fetchReferenceLibrary } from "../packages/core/src/reference-manager";
import type { CitationSource } from "../packages/core/src/citations";

const article = `@article{Rosa2020,
  author = {Rosa Garcia},
  title = {North beds},
  year = {2020}
}`;

const saved: CitationSource[] = [
  { id: "src-1", guid: "guid-1", tag: "kept", kind: "book", author: "Ada", title: "Notes", year: "2019", page: "" },
];

describe("reference manager", () => {
  it("imports an allowed https library and keeps the saved sources otherwise", async () => {
    let calls = 0;
    const fetchLibrary = async (address: string) => {
      calls += 1;
      expect(address).toBe("https://library.example/beds.bib");
      return { status: 200, body: article };
    };
    const denied = await fetchReferenceLibrary("https://library.example/beds.bib", saved, {
      allowed: false,
      online: true,
      fetchLibrary,
    });
    expect(calls).toBe(0);
    expect(denied.sources).toEqual(saved);
    expect(denied.fetched).toBe(false);
    expect(saved[0].title).toBe("Notes");

    const offline = await fetchReferenceLibrary("https://library.example/beds.bib", saved, {
      allowed: true,
      online: false,
      fetchLibrary,
    });
    expect(calls).toBe(0);
    expect(offline.issues[0].message).toContain("offline");

    const secret = await fetchReferenceLibrary("https://user:secret-value@library.example/beds.bib", saved, {
      allowed: true,
      online: true,
      fetchLibrary,
    });
    expect(calls).toBe(0);
    expect(secret.issues[0].message).not.toContain("secret-value");

    const failed = await fetchReferenceLibrary("https://library.example/beds.bib", saved, {
      allowed: true,
      online: true,
      fetchLibrary: async () => ({ status: 500, body: "token=secret-value" }),
    });
    expect(failed.sources[0].title).toBe("Notes");
    expect(failed.issues[0].message).not.toContain("secret-value");

    const loaded = await fetchReferenceLibrary("https://library.example/beds.bib", saved, {
      allowed: true,
      online: true,
      fetchLibrary,
    });
    expect(loaded.fetched).toBe(true);
    expect(loaded.sources.map((source) => source.tag)).toEqual(["kept", "Rosa2020"]);
    expect(saved).toHaveLength(1);
  });
});
