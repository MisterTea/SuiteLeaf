import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeElectron, resetFakeElectron } from "./desktop-electron-fake";

const mocks = vi.hoisted(() => ({
  runConvertCommand: vi.fn(),
  runImportCommand: vi.fn(),
  openPdfExportWindow: vi.fn(),
  openPngExportWindow: vi.fn(),
  migrateLocalData: vi.fn(async () => {}),
}));

vi.mock("electron", async () =>
  (await import("./desktop-electron-fake")).electronModule(),
);
vi.mock("../apps/desktop/src/convert-cli", async (load) => ({
  ...(await load<typeof import("../apps/desktop/src/convert-cli")>()),
  runConvertCommand: mocks.runConvertCommand,
}));
vi.mock("../apps/desktop/src/import-cli", () => ({
  runImportCommand: mocks.runImportCommand,
}));
vi.mock("../apps/desktop/src/pdf-export-host", () => ({
  openPdfExportWindow: mocks.openPdfExportWindow,
  openPngExportWindow: mocks.openPngExportWindow,
  renderPresentationPngs: vi.fn(),
}));
vi.mock("../apps/desktop/src/local-data", () => ({
  localDataDirectory: () => "/fake/local",
  migrateLocalData: mocks.migrateLocalData,
}));
vi.mock("../apps/desktop/src/office-converter", () => ({
  convertOffice: vi.fn(),
}));

let root: string;
const argv = process.argv;

async function run(...args: string[]) {
  process.argv = ["electron", "main.js", ...args];
  await import("../apps/desktop/src/main");
  const { app } = fakeElectron();
  await vi.waitFor(() => expect(app.exit).toHaveBeenCalled());
  return app.exit.mock.calls[0][0];
}

beforeAll(async () => {
  // Transform main.ts's heavy imports once, outside the timed tests.
  await import("../packages/core/src");
  await import("../apps/web/src/editors/slide-marp-import");
  await import("../apps/web/src/editors/drawing-format");
  await import("../apps/desktop/src/store");
}, 30_000);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "suiteleaf-main-cli-"));
  vi.resetModules();
  resetFakeElectron();
  vi.clearAllMocks();
  process.env.SUITELEAF_TEST_DATA = root;
  process.env.SUITELEAF_SETTINGS = join(root, "settings.json");
});

afterEach(async () => {
  process.argv = argv;
  delete process.env.SUITELEAF_TEST_DATA;
  delete process.env.SUITELEAF_SETTINGS;
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("desktop command line", () => {
  it("prints usage for --help and -h without opening a window", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await run("--help")).toBe(0);
    expect(log.mock.calls[0][0]).toMatch(/^Usage:/);
    expect(fakeElectron().app.requestSingleInstanceLock).not.toHaveBeenCalled();
    expect(fakeElectron().app.paths.userData).toBe(root);
  });

  it("drops Linux's --no-sandbox before reading the command", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await run("--no-sandbox", "-h")).toBe(0);
  });

  it("converts with renderers that stop the run when a window cannot open", async () => {
    mocks.runConvertCommand.mockImplementation(
      async (args: string[], options: Record<string, any>) => {
        expect(args).toEqual(["in", "--to", "pdf"]);
        const pdf = vi.fn();
        mocks.openPdfExportWindow.mockResolvedValueOnce(pdf);
        expect(await options.openRenderer()).toBe(pdf);
        mocks.openPdfExportWindow.mockRejectedValueOnce(new Error("no gpu"));
        await expect(options.openRenderer()).rejects.toMatchObject({
          name: "ConvertStopped",
          message: "no gpu",
        });
        mocks.openPngExportWindow.mockRejectedValueOnce("plain failure");
        await expect(options.openPngRenderer()).rejects.toMatchObject({
          message: "plain failure",
        });
        const png = vi.fn();
        mocks.openPngExportWindow.mockResolvedValueOnce(png);
        expect(await options.openPngRenderer()).toBe(png);
        return 3;
      },
    );
    expect(await run("convert", "in", "--to", "pdf")).toBe(3);
    expect(mocks.migrateLocalData).not.toHaveBeenCalled();
  });

  it("imports into the configured documents folder", async () => {
    await writeFile(
      join(root, "settings.json"),
      JSON.stringify({ documentsDirectory: join(root, "Docs") }),
    );
    mocks.runImportCommand.mockResolvedValue(0);
    expect(await run("import", "a.docx")).toBe(0);
    const [args, options] = mocks.runImportCommand.mock.calls[0];
    expect(args).toEqual(["a.docx"]);
    expect(options.defaultDirectory).toBe(join(root, "Docs"));
  });

  it("imports into SuiteLeaf in Documents and migrates data outside test runs", async () => {
    delete process.env.SUITELEAF_TEST_DATA;
    mocks.runImportCommand.mockResolvedValue(1);
    expect(await run("import")).toBe(1);
    expect(mocks.migrateLocalData).toHaveBeenCalledWith(
      "/fake/userData",
      "/fake/local",
    );
    expect(mocks.runImportCommand.mock.calls[0][1].defaultDirectory).toBe(
      join("/fake/documents", "SuiteLeaf"),
    );
  });

  it("exits with 2 when a command throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.runImportCommand.mockRejectedValue(new Error("disk full"));
    expect(await run("import")).toBe(2);
    expect(error).toHaveBeenCalledWith(new Error("disk full"));
  });

  it("quits a second app window instead of opening one", async () => {
    process.argv = ["electron", "main.js"];
    const { app } = fakeElectron();
    app.requestSingleInstanceLock.mockReturnValue(false);
    await import("../apps/desktop/src/main");
    expect(app.quit).toHaveBeenCalled();
    expect(fakeElectron().handlers.size).toBe(0);
  });
});
