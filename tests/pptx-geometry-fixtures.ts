import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";

export const theme = `<?xml version="1.0"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements>
<a:clrScheme name="Facet"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="2C3C43"/></a:dk2><a:lt2><a:srgbClr val="EBEBEB"/></a:lt2>
<a:accent1><a:srgbClr val="90C226"/></a:accent1><a:accent2><a:srgbClr val="54A021"/></a:accent2>
<a:accent3><a:srgbClr val="E6B91E"/></a:accent3><a:accent4><a:srgbClr val="E76618"/></a:accent4>
<a:accent5><a:srgbClr val="C42F1A"/></a:accent5><a:accent6><a:srgbClr val="918655"/></a:accent6>
<a:hlink><a:srgbClr val="99CA3C"/></a:hlink><a:folHlink><a:srgbClr val="B9D181"/></a:folHlink></a:clrScheme>
<a:fontScheme><a:majorFont><a:latin typeface="Trebuchet MS"/></a:majorFont><a:minorFont><a:latin typeface="Trebuchet MS"/></a:minorFont></a:fontScheme>
<a:fmtScheme><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:bgFillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill>
</a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;

export const relation = (id: string, kind: string, target: string) =>
  `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${target}"/>`;

export async function deck(
  slide: string,
  layout: string,
  master = `<p:sldMaster><p:cSld><p:spTree/></p:cSld></p:sldMaster>`,
  extra?: { slideRels?: string; files?: Record<string, Uint8Array | string> },
) {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
  );
  zip.file("ppt/slides/slide1.xml", slide);
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships>${relation("l", "slideLayout", "../slideLayouts/slideLayout1.xml")}${extra?.slideRels || ""}</Relationships>`,
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", layout);
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<Relationships>${relation("m", "slideMaster", "../slideMasters/slideMaster1.xml")}</Relationships>`,
  );
  zip.file("ppt/slideMasters/slideMaster1.xml", master);
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<Relationships>${relation("t", "theme", "../theme/theme1.xml")}</Relationships>`,
  );
  zip.file("ppt/theme/theme1.xml", theme);
  for (const [path, data] of Object.entries(extra?.files || {})) zip.file(path, data);
  return parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
}

export function svg(src: string | undefined) {
  const data = /^data:image\/svg\+xml;base64,(.+)$/.exec(src || "");
  return data ? Buffer.from(data[1], "base64").toString("utf8") : "";
}
