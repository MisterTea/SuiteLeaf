import { expect, it } from "vitest";
import * as CFB from "cfb";
import * as XLSX from "xlsx";
import { readBinaryLineCharts } from "../packages/core/src/excel-binary-charts";

it("imports BIFF line series references, axes, category labels and annotation text", () => {
  const rec = (type: number, payload: Uint8Array) => {
    const r = new Uint8Array(payload.length + 4);
    const v = new DataView(r.buffer);
    v.setUint16(0, type, true);
    v.setUint16(2, payload.length, true);
    r.set(payload, 4);
    return r;
  };
  const word = (n: number) => new Uint8Array([n & 255, n >> 8]);
  const bof = () => rec(0x809, new Uint8Array([0, 6, 32, 0]));
  const text = (s: string) => {
    const p = new Uint8Array(4 + s.length * 2);
    p[2] = s.length;
    p[3] = 1;
    const v = new DataView(p.buffer);
    [...s].forEach((c, i) => v.setUint16(4 + i * 2, c.charCodeAt(0), true));
    return rec(0x100d, p);
  };
  const bounds = new Uint8Array(8),
    extern = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]);
  const prefix = [
    bof(),
    rec(0x85, bounds),
    rec(0x85, bounds),
    rec(0x17, extern),
    rec(10, new Uint8Array()),
  ];
  const offset = prefix.reduce((n, r) => n + r.length, 0);
  new DataView(prefix[2].buffer).setUint32(4, offset, true);
  const ai = new Uint8Array(19),
    av = new DataView(ai.buffer);
  ai[0] = 1;
  ai[1] = 2;
  av.setUint16(4, 10, true);
  av.setUint16(6, 11, true);
  ai[8] = 0x3b;
  av.setUint16(11, 1, true);
  av.setUint16(13, 1, true);
  av.setUint16(15, 1, true);
  av.setUint16(17, 2, true);
  const cat = ai.slice();
  cat[0] = 2;
  new DataView(cat.buffer).setUint16(11, 0, true);
  new DataView(cat.buffer).setUint16(13, 0, true);
  const axis = new Uint8Array(42),
    axisView = new DataView(axis.buffer);
  axisView.setFloat64(0, 0.2, true);
  axisView.setFloat64(8, 0.8, true);
  axisView.setFloat64(16, 0.1, true);
  const txo = new Uint8Array(18);
  new DataView(txo.buffer).setUint16(10, 4, true);
  const records = [
    ...prefix,
    bof(),
    rec(0x1003, new Uint8Array(12)),
    rec(0x1051, new Uint8Array(8)),
    text("Usage"),
    rec(0x1051, ai),
    rec(0x1051, cat),
    rec(0x1007, new Uint8Array([255, 0, 255, 0])),
    rec(0x1045, word(0)),
    rec(0x1018, word(0)),
    rec(0x101f, axis),
    text("Rate"),
    text("Capacity"),
    rec(0x1063, word(15)),
    rec(0x1b6, txo),
    rec(0x3c, new Uint8Array([0, 78, 111, 116, 101])),
    rec(10, new Uint8Array()),
  ];
  const stream = Buffer.concat(records.map((r) => Buffer.from(r))),
    cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, "Workbook", stream);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      [null, "Jan", "Feb"],
      [null, 0.4, 0.6],
    ]),
    "Data",
  );
  XLSX.utils.book_append_sheet(
    book,
    { "!type": "chart" } as XLSX.WorkSheet,
    "Chart",
  );
  const charts = readBinaryLineCharts(
    new Uint8Array(CFB.write(cfb, { type: "buffer" })),
    book,
  );
  expect(charts).toHaveLength(1);
  expect(charts[0]).toMatchObject({
    title: "Capacity",
    sheetId: "sheet-2",
    excel: {
      series: [
        {
          name: "Usage",
          color: "#ff00ff",
          numberFormat: "0.00%",
          values: {
            sheetId: "sheet-1",
            startRow: 1,
            endRow: 1,
            startColumn: 1,
            endColumn: 2,
          },
        },
      ],
      biff: {
        categories: ["Jan", "Feb"],
        axisTitles: ["Rate"],
        annotations: ["Note"],
        dataTable: true,
        axes: [{ min: 0.2, max: 0.8, step: 0.1 }],
      },
    },
  });
});
