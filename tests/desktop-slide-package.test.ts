import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFile,
  isSlidePackageBytes,
  isSuitePackageBytes,
  serializeFile,
  type DocFile,
  type SheetFile,
  type SlideFile,
} from "@suiteleaf/core";
import { FileStore } from "../apps/desktop/src/store";
import { DesktopSlidePackageReader } from "../apps/desktop/src/slide-package-reader";

describe("desktop FileStore v2 slslides auto-upgrade & random-access reader", () => {
  it("opens legacy v1 .slslides, upgrades to v2 ZIP on save, and reads single slides in O(1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sl-v2-desktop-"));
    try {
      const store = new FileStore(join(dir, "lib"));
      await store.init();

      const deck = createFile("slide", "Quarterly") as SlideFile;
      const s1 = deck.content.slideOrder[0];
      deck.content.slides[s1].title = "Opening";
      deck.content.slideOrder.push("s2");
      deck.content.slides["s2"] = {
        id: "s2",
        title: "Deep Dive",
        elements: [
          {
            id: "t2",
            type: "text",
            x: 50,
            y: 50,
            width: 300,
            height: 60,
            content: "Hello v2",
          },
        ],
      };

      // Write legacy v1 JSON .slslides to disk
      const diskPath = join(dir, "Quarterly.slslides");
      await writeFile(diskPath, serializeFile(deck), "utf8");
      expect(isSlidePackageBytes(await readFile(diskPath))).toBe(false);

      // Open via FileStore -> succeeds seamlessly
      const opened = await store.openPath(diskPath);
      expect(opened.file.kind).toBe("slide");
      expect((opened.file as SlideFile).content.slideOrder).toEqual([s1, "s2"]);

      // Save edit -> automatically upgrades file on disk to v2 ZIP!
      const edited = structuredClone(opened.file) as SlideFile;
      edited.content.slides["s2"].elements[0].content = "Updated on desktop";
      await store.save({ ...opened, file: edited });

      const savedBytes = await readFile(diskPath);
      expect(isSlidePackageBytes(savedBytes)).toBe(true);

      // Reopen via FileStore -> reads v2 ZIP cleanly
      const reloaded = await store.reload(edited.id);
      expect(
        (reloaded?.file as SlideFile).content.slides["s2"].elements[0].content,
      ).toBe("Updated on desktop");

      // Random-access reader bootstraps only s1 and fetches s2 on demand
      const reader = new DesktopSlidePackageReader(diskPath);
      const boot = await reader.bootstrap(s1);
      expect(boot.manifest.version).toBe(2);
      expect(Object.keys(boot.slides)).toEqual([s1]);
      expect(boot.manifest.slides["s2"].thumbHash).toMatch(/^[a-f0-9]{64}$/);

      const s2 = await reader.readSlide("s2");
      expect(s2?.elements[0].content).toBe("Updated on desktop");

      const thumb = await reader.readMedia(boot.manifest.slides["s2"].thumbHash!);
      expect(thumb).not.toBeNull();
      expect(new TextDecoder().decode(thumb!)).toContain("<svg");

      // Also verify legacy v1 .sldoc and .slsheet auto-upgrade to v2 ZIP on save
      const doc = createFile("doc", "Notes") as DocFile;
      const docPath = join(dir, "Notes.sldoc");
      await writeFile(docPath, serializeFile(doc), "utf8");
      const openedDoc = await store.openPath(docPath);
      await store.save(openedDoc);
      expect(isSuitePackageBytes(await readFile(docPath))).toBe(true);
      expect((await store.reload(doc.id))?.file.kind).toBe("doc");

      const sheet = createFile("sheet", "Metrics") as SheetFile;
      const sheetPath = join(dir, "Metrics.slsheet");
      await writeFile(sheetPath, serializeFile(sheet), "utf8");
      const openedSheet = await store.openPath(sheetPath);
      await store.save(openedSheet);
      expect(isSuitePackageBytes(await readFile(sheetPath))).toBe(true);
      expect((await store.reload(sheet.id))?.file.kind).toBe("sheet");

      store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
