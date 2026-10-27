import { beforeAll, describe, expect, it } from "vitest";
import { isMisspelling, loadFullDictionary } from "../apps/web/src/editors/doc-spelling";

const none = { added: [], flagged: [] };
let loadMs = 0;

beforeAll(async () => {
  const started = performance.now();
  await loadFullDictionary();
  loadMs = performance.now() - started;
});

describe("full spelling dictionary", () => {
  it("knows real words outside the common-word list", () => {
    for (const word of ["Elf", "elves", "Zombies", "Nutcracker", "Melee", "narwhal", "reindeer", "sled", "grenade", "minnows"])
      expect(isMisspelling(word, none, []), word).toBe(false);
  });

  it("still flags misspellings, including ones common on the web", () => {
    for (const word of ["recieve", "teh", "quikly", "manuall", "Robotz", "movment"])
      expect(isMisspelling(word, none, []), word).toBe(true);
  });

  it("accepts names only with their capital", () => {
    expect(isMisspelling("Nazis", none, [])).toBe(false);
    expect(isMisspelling("NAZIS", none, [])).toBe(false);
    expect(isMisspelling("Zanzibar", none, [])).toBe(false);
    expect(isMisspelling("Nkrumah", none, [])).toBe(false);
    expect(isMisspelling("Danquah", none, [])).toBe(true);
    expect(isMisspelling("zanzibar", none, [])).toBe(true);
  });

  it("loads quickly enough to run after the editor opens", () => {
    expect(loadMs).toBeLessThan(3000);
  });
});
