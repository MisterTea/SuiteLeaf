import { expect, it } from "vitest";
import * as XLSX from "xlsx";
import * as CFB from "cfb";

import { importOffice } from "../packages/core/src/office";

it("retains BIFF frozen headers, automatic row heights, and wrapped cell alignment", async () => {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Task description"],
    ["Two lines of task text", 12],
  ]);
  sheet["!rows"] = [{ hpt: 30 }, { hpt: 45 }];
  XLSX.utils.book_append_sheet(book, sheet, "Tasks");
  const bytes = XLSX.write(book, { type: "array", bookType: "biff8" });
  const cfb = CFB.read(new Uint8Array(bytes), { type: "array" });
  const entry = cfb.FileIndex.find((e) => e.name === "Workbook")!;
  const stream = new Uint8Array(entry.content!);
  const data = new DataView(stream.buffer);
  const chunks: Uint8Array[] = [];
  let rowInserted = false;
  for (let offset = 0; offset + 4 <= stream.length;) {
    const type = data.getUint16(offset, true),
      size = data.getUint16(offset + 2, true);
    const record = stream.slice(offset, offset + 4 + size);
    const view = new DataView(record.buffer);
    if (type === 0x00e0 && size >= 20) record[10] = 0x1a; // center, wrap, middle
    if (type === 0x0208 && size >= 16) {
      view.setUint16(10, 600, true); // 30 points, even without manual-height flag
      record[16] &= ~0x40;
    }
    if (type === 0x023e) {
      view.setUint16(4, view.getUint16(4, true) | 8, true);
      const pane = new Uint8Array(14);
      const paneView = new DataView(pane.buffer);
      paneView.setUint16(0, 0x0041, true);
      paneView.setUint16(2, 10, true);
      paneView.setUint16(4, 1, true);
      paneView.setUint16(6, 1, true);
      chunks.push(record, pane);
    } else {
      if (!rowInserted && [0x00fd, 0x0203, 0x027e].includes(type)) {
        const row = new Uint8Array(20),
          rowView = new DataView(row.buffer);
        rowView.setUint16(0, 0x0208, true);
        rowView.setUint16(2, 16, true);
        rowView.setUint16(8, 2, true);
        rowView.setUint16(10, 600, true);
        chunks.push(row);
        rowInserted = true;
      }
      chunks.push(record);
    }
    offset += size + 4;
  }
  entry.content = Buffer.concat(chunks);
  entry.size = entry.content.length;
  const result = await importOffice(
    new Uint8Array(CFB.write(cfb, { type: "buffer" })),
    "xls",
    "tasks.xls",
  );
  if (result.file.kind !== "sheet") throw Error("Expected worksheet");
  const workbook = result.file.content.workbook;
  const imported = workbook.sheets[workbook.sheetOrder[0]];
  expect(imported.freeze).toMatchObject({ xSplit: 1, ySplit: 1 });
  expect(imported.rowData![0].h).toBe(40);
  expect(workbook.styles![imported.cellData![0][0].s as string]).toMatchObject({
    ht: 2,
    vt: 2,
    tb: 3,
  });
  expect(imported.cellData![1][0].v).toBe("Two lines of task text");
  expect(imported.cellData![1][1].v).toBe(12);
});
