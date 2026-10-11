import type JSZip from "jszip";
import {
  columnName,
  type ChartDefinition,
  type SheetFile,
  type SourceRange,
} from "./index";
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const ns =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const emu = (v: number) => Math.max(0, Math.round(v * 9525));
function reference(file: Pick<SheetFile, "content">, range: SourceRange) {
  const sheet = file.content.workbook.sheets[range.sheetId];
  return `'${sheet.name.replace(/'/g, "''")}'!$${columnName(range.startColumn)}$${range.startRow + 1}:$${columnName(range.endColumn)}$${range.endRow + 1}`;
}
function values(file: Pick<SheetFile, "content">, range: SourceRange) {
  const s = file.content.workbook.sheets[range.sheetId];
  const result: (string | number | boolean | null)[] = [];
  for (let r = range.startRow; r <= range.endRow; r++)
    for (let c = range.startColumn; c <= range.endColumn; c++)
      result.push(s.cellData?.[r]?.[c]?.v ?? null);
  return result;
}
function cache(
  file: Pick<SheetFile, "content">,
  range: SourceRange,
  numeric: boolean,
) {
  const v = values(file, range),
    tag = numeric ? "num" : "str";
  return `<c:${tag}Ref><c:f>${esc(reference(file, range))}</c:f><c:${tag}Cache>${numeric ? "<c:formatCode>General</c:formatCode>" : ""}<c:ptCount val="${v.length}"/>${v.map((value, i) => (value === null || (numeric && typeof value !== "number") ? "" : `<c:pt idx="${i}"><c:v>${esc(value)}</c:v></c:pt>`)).join("")}</c:${tag}Cache></c:${tag}Ref>`;
}
function chartXml(file: Pick<SheetFile, "content">, chart: ChartDefinition) {
  const source = chart.source;
  const categories = {
    ...source,
    startRow: Math.min(source.endRow, source.startRow + 1),
    endColumn: source.startColumn,
  };
  const series =
    chart.excel?.series ??
    Array.from(
      { length: Math.max(1, source.endColumn - source.startColumn) },
      (_, i) => ({
        name: String(
          file.content.workbook.sheets[source.sheetId].cellData?.[
            source.startRow
          ]?.[source.startColumn + i + 1]?.v ?? `Series ${i + 1}`,
        ),
        values: {
          ...source,
          startRow: Math.min(source.endRow, source.startRow + 1),
          startColumn: Math.min(source.endColumn, source.startColumn + i + 1),
          endColumn: Math.min(source.endColumn, source.startColumn + i + 1),
        },
        color: ["#4285f4", "#34a853", "#fbbc04", "#ea4335"][i % 4],
      }),
    );
  const seriesXml = series
    .map(
      (s, i) =>
        `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${s.color.replace("#", "")}"/></a:solidFill></c:spPr>${chart.type === "scatter" ? `<c:xVal>${cache(file, categories, true)}</c:xVal><c:yVal>${cache(file, s.values, true)}</c:yVal>` : `<c:cat>${cache(file, categories, false)}</c:cat><c:val>${cache(file, s.values, true)}</c:val>`}</c:ser>`,
    )
    .join("");
  const axes =
    chart.type === "pie" ? "" : `<c:axId val="100"/><c:axId val="200"/>`;
  const type = `${chart.type}Chart`;
  const config =
    chart.type === "bar"
      ? '<c:barDir val="col"/><c:grouping val="clustered"/>'
      : chart.type === "line"
        ? '<c:grouping val="standard"/>'
        : chart.type === "scatter"
          ? '<c:scatterStyle val="marker"/>'
          : '<c:varyColors val="1"/>';
  const axisXml =
    chart.type === "pie"
      ? ""
      : `<c:${chart.type === "scatter" ? "valAx" : "catAx"}><c:axId val="100"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="200"/><c:crosses val="autoZero"/></c:${chart.type === "scatter" ? "valAx" : "catAx"}><c:valAx><c:axId val="200"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:crossAx val="100"/><c:crosses val="autoZero"/></c:valAx>`;
  return `${declaration}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${esc(chart.title)}</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:layout/><c:${type}>${config}${seriesXml}${axes}</c:${type}>${axisXml}</c:plotArea><c:legend><c:legendPos val="r"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;
}
export async function addXlsxDrawings(
  zip: JSZip,
  file: Pick<SheetFile, "content">,
) {
  let chartIndex = 0,
    imageIndex = 0;
  let contentTypes = await zip.file("[Content_Types].xml")!.async("string");
  const addType = (path: string, type: string) => {
    contentTypes = contentTypes.replace(
      "</Types>",
      `<Override PartName="/${path}" ContentType="${type}"/></Types>`,
    );
  };
  const wb = file.content.workbook;
  for (let i = 0; i < wb.sheetOrder.length; i++) {
    const id = wb.sheetOrder[i],
      sheet = wb.sheets[id];
    const charts = file.content.charts.filter(
      (c) => c.sheetId === id && !c.invalid && wb.sheets[c.source.sheetId],
    );
    const images = (file.content.images ?? []).filter(
      (image) => image.sheetId === id,
    );
    if (!charts.length && !images.length) continue;
    const anchors: string[] = [],
      relationships: string[] = [];
    const anchor = (
      x: number,
      y: number,
      width: number,
      height: number,
      body: string,
    ) =>
      `<xdr:absoluteAnchor><xdr:pos x="${emu(x)}" y="${emu(y)}"/><xdr:ext cx="${emu(width)}" cy="${emu(height)}"/>${body}<xdr:clientData/></xdr:absoluteAnchor>`;
    for (const chart of charts) {
      const n = ++chartIndex,
        rId = `chart${n}`;
      zip.file(`xl/charts/chart${n}.xml`, chartXml(file, chart));
      addType(
        `xl/charts/chart${n}.xml`,
        "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
      );
      relationships.push(
        `<Relationship Id="${rId}" Type="${ns}/chart" Target="../charts/chart${n}.xml"/>`,
      );
      anchors.push(
        anchor(
          chart.x,
          chart.y,
          chart.width,
          chart.height,
          `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${anchors.length + 1}" name="${esc(chart.title)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${rId}"/></a:graphicData></a:graphic></xdr:graphicFrame>`,
        ),
      );
    }
    for (const image of images) {
      const m = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,(.*)$/i.exec(
        image.src,
      );
      if (!m) continue;
      const n = ++imageIndex,
        ext = m[1] === "svg+xml" ? "svg" : m[1],
        path = `xl/media/image${n}.${ext}`,
        rId = `image${n}`;
      zip.file(path, m[2], { base64: true });
      addType(path, `image/${m[1]}`);
      relationships.push(
        `<Relationship Id="${rId}" Type="${ns}/image" Target="../media/image${n}.${ext}"/>`,
      );
      const x =
        Array.from(
          { length: image.column },
          (_, c) =>
            (sheet.columnData as any)?.[c]?.w ??
            sheet.defaultColumnWidth ??
            100,
        ).reduce((sum, v) => sum + v, 0) + image.offsetX;
      const y =
        Array.from(
          { length: image.row },
          (_, r) =>
            (sheet.rowData as any)?.[r]?.h ?? sheet.defaultRowHeight ?? 24,
        ).reduce((sum, v) => sum + v, 0) + image.offsetY;
      const imageAnchor = anchor(
        x,
        y,
        image.width,
        image.height,
        `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${anchors.length + 1}" name="Image ${n}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>`,
      );
      anchors.push(
        imageAnchor
          .replace(
            /<xdr:absoluteAnchor><xdr:pos[^>]*\/>/,
            `<xdr:oneCellAnchor><xdr:from><xdr:col>${image.column}</xdr:col><xdr:colOff>${emu(image.offsetX)}</xdr:colOff><xdr:row>${image.row}</xdr:row><xdr:rowOff>${emu(image.offsetY)}</xdr:rowOff></xdr:from>`,
          )
          .replace("</xdr:absoluteAnchor>", "</xdr:oneCellAnchor>"),
      );
    }
    const drawing = `xl/drawings/drawing${i + 1}.xml`;
    zip.file(
      drawing,
      `${declaration}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${ns}">${anchors.join("")}</xdr:wsDr>`,
    );
    zip.file(
      `xl/drawings/_rels/drawing${i + 1}.xml.rels`,
      `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join("")}</Relationships>`,
    );
    addType(
      drawing,
      "application/vnd.openxmlformats-officedocument.drawing+xml",
    );
    const relsPath = `xl/worksheets/_rels/sheet${i + 1}.xml.rels`;
    let rels =
      (await zip.file(relsPath)?.async("string")) ??
      `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
    rels = rels.replace(
      "</Relationships>",
      `<Relationship Id="suiteleafDrawing" Type="${ns}/drawing" Target="../drawings/drawing${i + 1}.xml"/></Relationships>`,
    );
    zip.file(relsPath, rels);
    const path = `xl/worksheets/sheet${i + 1}.xml`;
    const drawingRef = '<drawing r:id="suiteleafDrawing"/>';
    let text = await zip.file(path)!.async("string");
    text = text.includes("<legacyDrawing")
      ? text.replace("<legacyDrawing", `${drawingRef}<legacyDrawing`)
      : text.replace("</worksheet>", `${drawingRef}</worksheet>`);
    zip.file(path, text);
  }
  zip.file("[Content_Types].xml", contentTypes);
}
