import { expect, it } from "vitest";
import JSZip from "jszip";
import { importOffice } from "../packages/core/src/office";
import { parseFile, serializeFile } from "../packages/core/src";
import { excelFixture } from "./office-fixtures";

it("preserves independent headerless line series and fractional drawing anchors", async () => {
  const z = await JSZip.loadAsync(await excelFixture());
  z.file(
    "xl/worksheets/_rels/sheet1.xml.rels",
    '<Relationships><Relationship Id="d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
  );
  z.file(
    "xl/drawings/_rels/drawing1.xml.rels",
    '<Relationships><Relationship Id="chart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>',
  );
  z.file(
    "xl/drawings/drawing1.xml",
    '<xdr:wsDr><xdr:twoCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:row>4</xdr:row><xdr:colOff>19050</xdr:colOff><xdr:rowOff>9525</xdr:rowOff></xdr:from><xdr:to><xdr:col>9</xdr:col><xdr:row>17</xdr:row><xdr:colOff>28575</xdr:colOff></xdr:to><xdr:graphicFrame><a:graphic><a:graphicData><c:chart r:id="chart"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:twoCellAnchor></xdr:wsDr>',
  );
  z.file(
    "xl/charts/chart1.xml",
    '<c:chartSpace><c:chart><c:plotArea><c:lineChart><c:ser><c:tx><c:v>North</c:v></c:tx><c:val><c:numRef><c:f>Budget!$A$1:$A$6</c:f></c:numRef></c:val></c:ser><c:ser><c:tx><c:v>South</c:v></c:tx><c:val><c:numRef><c:f>Budget!$C$1:$C$6</c:f></c:numRef></c:val></c:ser><c:marker val="1"/></c:lineChart></c:plotArea><c:legend><c:legendPos val="r"/></c:legend></c:chart></c:chartSpace>',
  );
  const { file } = await importOffice(
    await z.generateAsync({ type: "uint8array" }),
    "xlsx",
    "chart.xlsx",
  );
  if (file.kind !== "sheet") throw Error("Expected workbook");
  const c = file.content.charts[0];
  expect(c.title).toBe("");
  expect(
    c.excel?.series.map((s) => [
      s.name,
      s.values.startRow,
      s.values.startColumn,
      s.values.endRow,
    ]),
  ).toEqual([
    ["North", 0, 0, 5],
    ["South", 0, 2, 5],
  ]);
  expect(c.excel?.anchor).toMatchObject({
    fromColumn: 2,
    fromRow: 4,
    fromColumnOffset: 2,
    fromRowOffset: 1,
    toColumn: 9,
    toRow: 17,
    toColumnOffset: 3,
  });
  expect(parseFile(serializeFile(file))).toEqual(file);
});
