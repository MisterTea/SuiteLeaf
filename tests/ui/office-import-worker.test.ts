// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFile, serializeFile, type SheetFile } from "../../packages/core/src";
import { importOfficeFile } from "../../apps/web/src/office-import";
import { requestOfficePassword } from "../../apps/web/src/office-password";
import { importFile } from "../../apps/web/src/imports";
import type { DelimitedOptions } from "../../apps/web/src/csv";

vi.mock("../../apps/web/src/office-password.css", () => ({}));

type Reply = { ok: true; file: unknown } | { ok: false; code?: string; error: string } | "error" | "silent";
const workers: FakeWorker[] = [];
let replies: Reply[] = [];

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  posted: { message: Record<string, unknown>; transfer: unknown[] }[] = [];
  terminated = false;
  constructor(public url: URL) {
    workers.push(this);
  }
  postMessage(message: Record<string, unknown>, transfer: unknown[]) {
    this.posted.push({ message, transfer });
    const reply = replies.shift() ?? "silent";
    if (reply === "silent") return;
    queueMicrotask(() => {
      if (reply === "error") this.onerror?.({ message: "" });
      else this.onmessage?.({ data: reply });
    });
  }
  terminate() {
    this.terminated = true;
  }
}

beforeEach(() => {
  workers.length = 0;
  replies = [];
  vi.stubGlobal("Worker", FakeWorker);
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const docx = (name = "Letter.docx") => new File([new Uint8Array([1, 2, 3])], name);
const dialog = () => document.querySelector<HTMLDialogElement>(".office-password-dialog");
const waitForDialog = () => vi.waitFor(() => expect(dialog()).not.toBeNull());

describe("Office import worker", () => {
  it("sends the file to the converter and opens the result", async () => {
    const file = createFile("doc", "Letter");
    replies = [{ ok: true, file }];
    const opened = await importOfficeFile(docx("Letter.DOCX"));
    expect(opened.title).toBe("Letter");
    const [worker] = workers;
    expect(worker.url.pathname).toMatch(/office-worker\.ts$/);
    expect(worker.posted[0].message).toMatchObject({ format: "docx", name: "Letter.DOCX", password: undefined });
    expect(worker.posted[0].transfer[0]).toBe(worker.posted[0].message.bytes);
    expect(worker.terminated).toBe(true);
  });

  it("reports the converter's error and a worker that failed to load", async () => {
    replies = [{ ok: false, error: "Not a Word file." }];
    await expect(importOfficeFile(docx())).rejects.toThrow("Not a Word file.");
    replies = ["error"];
    await expect(importOfficeFile(docx())).rejects.toThrow("The Office converter could not load this file.");
    replies = [{ ok: true, file: null }];
    await expect(importOfficeFile(docx())).rejects.toThrow("The Office converter could not load this file.");
  });

  it("asks for a password, retries a wrong one, and opens the file", async () => {
    replies = [
      { ok: false, code: "encrypted", error: "Encrypted." },
      { ok: false, code: "wrong-password", error: "Wrong." },
      { ok: true, file: createFile("sheet", "Budget") },
    ];
    const opening = importOfficeFile(docx("Budget.xlsx"));
    await waitForDialog();
    expect(dialog()!.textContent).toContain("Budget.xlsx");
    expect(dialog()!.textContent).toContain("Enter the password used to protect this file.");
    const input = dialog()!.querySelector("input")!;
    expect(input.type).toBe("password");
    input.value = "first";
    dialog()!.querySelector("form")!.requestSubmit();
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    await waitForDialog();
    expect(dialog()!.textContent).toContain("The password is incorrect. Try again.");
    dialog()!.querySelector("input")!.value = "second";
    dialog()!.querySelector("form")!.requestSubmit();
    expect((await opening).title).toBe("Budget");
    expect(workers.map((w) => w.posted[0].message.password)).toEqual([undefined, "first", "second"]);
    expect(dialog()).toBeNull();
  });

  it("stops when the person cancels the password", async () => {
    replies = [{ ok: false, code: "encrypted", error: "Encrypted." }];
    const opening = importOfficeFile(docx());
    await waitForDialog();
    [...dialog()!.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!.click();
    await expect(opening).rejects.toThrow("Import cancelled.");
  });

  it("keeps the saved file when the import is stopped", async () => {
    const saved = createFile("sheet", "Saved");
    expect(await importOfficeFile(docx(), { saved, shouldStop: () => true })).toBe(saved);
    await expect(importOfficeFile(docx(), { shouldStop: () => true })).rejects.toThrow(
      "Import cancelled. The original file is unchanged.",
    );
    expect(workers).toHaveLength(0);

    let stop = false;
    replies = ["silent"];
    const running = importOfficeFile(docx(), { saved, shouldStop: () => stop });
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    stop = true;
    expect(await running).toBe(saved);
    expect(workers[0].terminated).toBe(true);
  });

  it("drops a result that arrives after the person stopped", async () => {
    let stop = false;
    replies = ["silent"];
    const running = importOfficeFile(docx(), { shouldStop: () => stop });
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    stop = true;
    workers[0].onmessage!({ data: { ok: true, file: createFile("doc", "Late") } });
    await expect(running).rejects.toThrow("Import cancelled. The original file is unchanged.");
    // A later message from the same worker changes nothing.
    workers[0].onmessage!({ data: { ok: false, error: "x" } });
    workers[0].onerror!({ message: "x" });
  });

  it("reports converter startup and validated slide progress", async () => {
    const onStage = vi.fn();
    const onProgress = vi.fn();
    const running = importOfficeFile(docx("Lecture.pptx"), { onStage, onProgress });
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    expect(onStage).toHaveBeenCalledWith("loading");
    const worker = workers[0];
    worker.onmessage!({ data: { started: true } });
    expect(onStage).toHaveBeenLastCalledWith("converting");
    worker.onmessage!({ data: { progress: { completed: 1, total: 3 } } });
    worker.onmessage!({ data: { progress: { completed: 1, total: 3 } } });
    expect(onProgress.mock.calls).toEqual([[1, 3]]);
    worker.onmessage!({ data: { ok: true, file: createFile("slide", "Lecture") } });
    await running;
  });

  it("allows a presentation to take longer than two minutes while slides advance", async () => {
    vi.useFakeTimers();
    const running = importOfficeFile(docx("Lecture.pptx"));
    await vi.advanceTimersByTimeAsync(90_000);
    const worker = workers[0];
    worker.onmessage!({ data: { progress: { completed: 1, total: 3 } } });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(worker.terminated).toBe(false);
    worker.onmessage!({ data: { progress: { completed: 2, total: 3 } } });
    await vi.advanceTimersByTimeAsync(90_000);
    const file = createFile("slide", "Lecture");
    worker.onmessage!({ data: { ok: true, file } });
    expect(await running).toBe(file);
    expect(worker.terminated).toBe(true);
    worker.onmessage!({ data: { progress: { completed: 3, total: 3 } } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still times out when progress stalls or repeats", async () => {
    vi.useFakeTimers();
    const running = importOfficeFile(docx("Stalled.pptx"));
    const failed = expect(running).rejects.toThrow("importing “Stalled.pptx”");
    await vi.advanceTimersByTimeAsync(90_000);
    const worker = workers[0];
    worker.onmessage!({ data: { progress: { completed: 1, total: 3 } } });
    await vi.advanceTimersByTimeAsync(90_000);
    worker.onmessage!({ data: { progress: { completed: 1, total: 3 } } });
    worker.onmessage!({ data: { progress: { completed: 99, total: 3 } } });
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    expect(worker.terminated).toBe(true);
  });

  it("gives up after two minutes without progress and names the file", async () => {
    vi.useFakeTimers();
    replies = ["silent"];
    const running = importOfficeFile(docx());
    const failed = expect(running).rejects.toThrow(
      "The Office converter did not start within two minutes for “Letter.docx”. Reload the page and check your connection. The original file is unchanged.",
    );
    await vi.advanceTimersByTimeAsync(120_000);
    await failed;
  });
});

describe("Office password prompt", () => {
  it("returns null when the dialog is dismissed", async () => {
    const asking = requestOfficePassword("a.docx", false);
    dialog()!.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(await asking).toBeNull();
    expect(dialog()).toBeNull();
  });
});

describe("importing files", () => {
  const named = (name: string, text: string | Uint8Array, size?: number) => {
    const file = new File([text as BlobPart], name);
    if (size !== undefined) Object.defineProperty(file, "size", { value: size });
    return file;
  };

  it("sends Office files to the converter within the size limits", async () => {
    replies = [{ ok: true, file: createFile("slide", "Deck") }];
    expect((await importFile(named("Deck.pptx", "x")))!.title).toBe("Deck");
    await expect(importFile(named("Big.docx", "x", 121 * 1024 * 1024))).rejects.toThrow(
      "Office imports are limited to 120 MB.",
    );
    await expect(importFile(named("Big.pptx", "x", 513 * 1024 * 1024))).rejects.toThrow(
      "Office imports are limited to 512 MB.",
    );
  });

  it("opens native files and refuses oversized ones", async () => {
    const doc = createFile("doc", "Mine");
    expect((await importFile(named("Mine.sldoc", serializeFile(doc))))!.id).toBe(doc.id);
    await expect(importFile(named("Huge.sldoc", "x", 10 ** 10))).rejects.toThrow(/Choose a native file smaller than/);
    await expect(importFile(named("Huge.txt", "x", 51 * 1024 * 1024))).rejects.toThrow(
      "Choose a file smaller than 50 MB.",
    );
  });

  it("keeps the saved file if stopped while reading", async () => {
    const saved = createFile("doc", "Saved");
    let calls = 0;
    const control = { saved, shouldStop: () => calls++ > 0 };
    expect(await importFile(named("notes.txt", "x"), undefined, undefined, control)).toBe(saved);
    calls = 0;
    await expect(
      importFile(named("notes.txt", "x"), undefined, undefined, { shouldStop: () => calls++ > 0 }),
    ).rejects.toThrow("Import cancelled. The original file is unchanged.");
  });

  it("turns text into paragraphs and HTML into a document", async () => {
    const text = await importFile(named("Notes.txt", "one\r\n\ntwo"));
    expect(text).toMatchObject({ kind: "doc", title: "Notes" });
    expect((text!.content as { content: unknown[] }).content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "one" }] },
      { type: "paragraph", content: [] },
      { type: "paragraph", content: [{ type: "text", text: "two" }] },
    ]);
    const html = await importFile(named(".htm", "<h1>Hi</h1>"));
    expect(html).toMatchObject({ kind: "doc", title: "Imported file" });
    expect(JSON.stringify(html!.content)).toContain("Hi");
  }, 20_000);

  it("imports delimited files with the reviewed options", async () => {
    const sheet = (await importFile(named("Plan.csv", "a,b\n1,2"))) as SheetFile;
    const cells = sheet.content.workbook.sheets[sheet.content.workbook.sheetOrder[0]];
    expect(cells.cellData![1][1]).toMatchObject({ v: 2 });
    expect(cells.rowCount).toBe(1000);

    const review = vi.fn<(draft: unknown) => Promise<DelimitedOptions>>(async () => ({
      delimiter: ";",
      header: false,
      convert: false,
      keepIdentifiers: false,
    }));
    const reviewed = (await importFile(named("Plan.tsv", "a;b\tc\n1;2\t3"), review)) as SheetFile;
    expect(review.mock.calls[0][0]).toMatchObject({ name: "Plan.tsv", delimiter: "\t" });
    const data = reviewed.content.workbook.sheets[reviewed.content.workbook.sheetOrder[0]].cellData!;
    expect(data[0][0]).toEqual({ v: "a", t: 1 });
    expect(data[1][1]).toEqual({ v: "2\t3", t: 1 });

    expect(await importFile(named("Plan.csv", "a,b"), async () => null)).toBeNull();
    await expect(importFile(named("Empty.csv", ""))).rejects.toThrow("This file has no rows.");
    await expect(importFile(named("Bad.csv", 'a,"b\n1,2'))).rejects.toThrow(
      "Could not parse delimited file: That delimited file could not be read.",
    );
    await expect(
      importFile(named("Bad.csv", 'a;b\n1;2'), async () => ({
        delimiter: ",",
        header: false,
        convert: true,
        keepIdentifiers: true,
      })),
    ).resolves.not.toBeNull();
    const wide = Array.from({ length: 2 }, () => Array(100_001).fill("1").join(",")).join("\n");
    await expect(importFile(named("Wide.csv", wide))).rejects.toThrow("Imports are limited to 200,000 cells.");
  });

  it("reports a reviewed delimiter that cannot read the file", async () => {
    await expect(
      importFile(named("Odd.csv", 'a|"b\n1|2'), async () => ({
        delimiter: "|",
        header: false,
        convert: true,
        keepIdentifiers: true,
      })),
    ).rejects.toThrow("Could not parse delimited file:");
  });

  it("builds a MARP deck with its pictures and imports drawings", async () => {
    const deck = await importFile(
      named("Talk.md", "---\nmarp: true\n---\n![](a.png)\n![](b.png)"),
      undefined,
      { "a.png": new Uint8Array([0x89, 0x50]), "b.png": "data:image/png;base64,QQ==" },
    );
    expect(deck!.kind).toBe("slide");
    const text = JSON.stringify(deck!.content);
    expect(text).toContain("data:image/png;base64,iVA=");
    expect(text).toContain("data:image/png;base64,QQ==");
    const drawing = await importFile(named("Flow.mmd", "graph TD; A-->B"));
    expect(drawing).toMatchObject({ kind: "drawing", title: "Flow" });
    await expect(importFile(named("photo.bmp", "x"))).rejects.toThrow(/^Supported formats:/);
  });
});
