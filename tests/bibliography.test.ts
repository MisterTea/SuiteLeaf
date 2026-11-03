import { expect, it } from "vitest";
import { createFile, parseFile, serializeFile } from "../packages/core/src";
import { applyImportedCitations, citationLibrary } from "../packages/core/src/citations";
import { exportBibtex, exportRis, importBibtex, importRis } from "../packages/core/src/bibliography";

const article = `@article{Rosa2020,
  author = {Rosa Garcia},
  title = {North beds},
  year = {2020},
  journal = {Garden Notes},
  volume = {4},
  pages = {12--18},
  doi = {10.1000/beds},
  url = {https://example.test/beds},
  accessed = {2026-10-31}
}`;

it("does not store a credential in an imported source address", () => {
  const imported = importBibtex(
    `@article{Rosa2020,
      author = {Rosa Garcia},
      title = {North beds},
      year = {2020},
      doi = {10.1000/beds},
      url = {https://ada:secret-value@example.test/beds}
    }`,
    [],
  );
  expect(imported.sources[0]?.doi).toBe("10.1000/beds");
  expect(imported.sources[0]?.url).toBeUndefined();
  expect(imported.issues).toEqual([
    { key: "Rosa2020", message: "That source address cannot include a credential." },
  ]);
  expect(JSON.stringify(imported.issues)).not.toContain("secret-value");
  expect(exportBibtex(imported.sources)).not.toContain("secret-value");
  const hidden = importRis(
    ["TY  - JOUR", "ID  - secret-value", "AU  - Ada", "TI  - Beds", "PY  - 2020", "UR  - https://example.test/token", "ER  - "].join("\n"),
    [],
  );
  expect(hidden.sources[0]?.url).toBeUndefined();
  expect(hidden.issues).toEqual([
    { key: "", message: "That source address cannot include a credential." },
  ]);
  expect(JSON.stringify(hidden.issues)).not.toContain("secret-value");
  expect(hidden.sources[0]?.title).toBe("Beds");
});

it("imports a BibTeX article, updates it by key, and writes it back", () => {
  const first = importBibtex(article, []);
  expect(first.issues).toEqual([]);
  expect(first.sources).toHaveLength(1);
  expect(first.sources[0]).toMatchObject({
    tag: "Rosa2020",
    kind: "article",
    author: "Rosa Garcia",
    title: "North beds",
    year: "2020",
    journal: "Garden Notes",
    volume: "4",
    pages: "12--18",
    doi: "10.1000/beds",
    url: "https://example.test/beds",
    accessed: "2026-10-31",
  });
  const kept = citationLibrary({
    attrs: { citationSources: first.sources },
  });
  expect(kept.sources[0].doi).toBe("10.1000/beds");
  const updated = importBibtex(
    article.replace("North beds", "South beds"),
    first.sources,
  );
  expect(updated.sources).toHaveLength(1);
  expect(updated.sources[0].id).toBe(first.sources[0].id);
  expect(updated.sources[0].title).toBe("South beds");
  expect(updated.sources[0].doi).toBe("10.1000/beds");
  const written = exportBibtex(updated.sources);
  expect(written.startsWith("@article{Rosa2020,")).toBe(true);
  expect(importBibtex(written, []).sources[0].title).toBe("South beds");
});

it("keeps the DOI and the other fields after the document is saved and opened", () => {
  const file = createFile("doc", "Notes");
  if (file.kind !== "doc") throw new Error("expected a document");
  const imported = importBibtex(
    article.replace("accessed = {2026-10-31}", "accessed = {2026-10-31},\n  note = {secret-value}"),
    [],
  );
  const applied = applyImportedCitations(file.content, {
    style: "apa",
    sources: imported.sources,
  });
  file.content = applied.content;
  const reopened = parseFile(serializeFile(file));
  if (reopened.kind !== "doc") throw new Error("expected a document");
  const library = citationLibrary(reopened.content);
  expect(library.sources[0]).toMatchObject({
    tag: "Rosa2020",
    title: "North beds",
    journal: "Garden Notes",
    volume: "4",
    pages: "12--18",
    doi: "10.1000/beds",
    url: "https://example.test/beds",
    accessed: "2026-10-31",
  });
  expect(exportBibtex(library.sources)).toContain("doi = {10.1000/beds}");
  expect(JSON.stringify(reopened)).not.toContain("secret-value");
  expect(imported.sources[0].title).toBe("North beds");
});

it("reports an entry that is not a book or an article and adds nothing", () => {
  const result = importBibtex(
    `@misc{Nope,\n  author = {Ada},\n  title = {Other},\n  year = {2021}\n}`,
    [],
  );
  expect(result.sources).toEqual([]);
  expect(result.issues).toEqual([
    { key: "Nope", message: "Only a book or an article can be imported." },
  ]);
});

it("imports a RIS article, updates it by ID, and writes it back", () => {
  const ris = [
    "TY  - JOUR",
    "ID  - Rosa2020",
    "AU  - Rosa Garcia",
    "TI  - North beds",
    "PY  - 2020",
    "JO  - Garden Notes",
    "VL  - 4",
    "SP  - 12",
    "EP  - 18",
    "DO  - 10.1000/beds",
    "UR  - https://example.test/beds",
    "DA  - 2026-10-31",
    "ER  - ",
  ].join("\n");
  const first = importRis(ris, []);
  expect(first.issues).toEqual([]);
  expect(first.sources[0]).toMatchObject({
    tag: "Rosa2020",
    kind: "article",
    title: "North beds",
    pages: "12--18",
    doi: "10.1000/beds",
  });
  const updated = importRis(ris.replace("North beds", "South beds"), first.sources);
  expect(updated.sources).toHaveLength(1);
  expect(updated.sources[0].id).toBe(first.sources[0].id);
  expect(updated.sources[0].title).toBe("South beds");
  const written = exportRis(updated.sources);
  expect(written).toContain("TY  - JOUR");
  expect(importRis(written, []).sources[0].title).toBe("South beds");
  const other = importRis("TY  - CONF\nTI  - Talk\nAU  - Ada\nPY  - 2021\nER  - \n", []);
  expect(other.sources).toEqual([]);
  expect(other.issues[0]?.message).toBe("Only a book or an article can be imported.");
});

it("keeps every editor from BibTeX and RIS and drops a broken name", () => {
  const imported = importBibtex(
    `@book{Beds,\n  author = {Mensah},\n  title = {Paths},\n  year = {2024},\n  editor = {Priya and Sam and secret\nvalue}\n}`,
    [],
  );
  expect(imported.sources[0]?.editors).toEqual(["Priya", "Sam"]);
  expect(imported.sources[0]?.editor).toBe("Priya");
  expect(JSON.stringify(imported.sources)).not.toContain("secret");
  const written = exportBibtex(imported.sources);
  expect(written).toContain("editor = {Priya and Sam}");
  expect(written).not.toContain("secret");
  expect(importBibtex(written, []).sources[0]?.editors).toEqual(["Priya", "Sam"]);
  const ris = importRis(
    ["TY  - BOOK", "ID  - Beds", "AU  - Mensah", "TI  - Paths", "PY  - 2024", "ED  - Priya", "ED  - Sam", "ER  - "].join(
      "\n",
    ),
    [],
  );
  expect(ris.sources[0]?.editors).toEqual(["Priya", "Sam"]);
  expect(exportRis(ris.sources)).toContain("ED  - Priya");
  expect(exportRis(ris.sources)).toContain("ED  - Sam");
  const one = importBibtex(
    `@book{Beds,\n  author = {Mensah},\n  title = {Paths},\n  year = {2024},\n  editor = {Ada}\n}`,
    imported.sources,
  );
  expect(one.sources[0]?.editor).toBe("Ada");
  expect(one.sources[0]?.editors).toBeUndefined();
});

it("imports a website and writes it back without a credential", () => {
  const imported = importBibtex(
    `@online{Beds,\n  author = {Rosa},\n  title = {North beds},\n  year = {2024},\n  url = {https://example.test/beds}\n}`,
    [],
  );
  expect(imported.sources[0]?.kind).toBe("website");
  expect(imported.sources[0]?.url).toBe("https://example.test/beds");
  expect(exportBibtex(imported.sources)).toContain("@online{Beds,");
  const misc = importBibtex(
    `@misc{Paths,\n  author = {Rosa},\n  title = {Paths},\n  year = {2024},\n  url = {https://user:secret-value@example.test/paths}\n}`,
    [],
  );
  expect(misc.sources[0]?.kind).toBe("website");
  expect(misc.sources[0]?.url).toBeUndefined();
  expect(misc.issues[0]?.message).toBe("That source address cannot include a credential.");
  expect(JSON.stringify(misc.issues)).not.toContain("secret-value");
  const ris = importRis(
    ["TY  - ELEC", "ID  - Beds", "AU  - Rosa", "TI  - North beds", "PY  - 2024", "UR  - https://example.test/beds", "ER  - "].join(
      "\n",
    ),
    [],
  );
  expect(ris.sources[0]?.kind).toBe("website");
  expect(exportRis(ris.sources)).toContain("TY  - ELEC");
});
