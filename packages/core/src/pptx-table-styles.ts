/**
 * Built-in PowerPoint table styles are not stored in the package.
 * Medium Style 1 paints a solid header, a tinted band, and accent rules.
 * Accent variants replace dk1 with that accent, per MS-OE376.
 */
const mediumStyle1Color: Record<string, string> = {
  "793d81cf-94f2-401a-ba57-92f5a7b2d0c5": "dk1",
  "b301b821-a1ff-4177-aee7-76d212191a09": "accent1",
  "9dcaf9ed-07dc-4a11-8d7f-57b35c25682e": "accent2",
  "1fecb4d8-db02-4dc6-a0a2-4f2ebae1dc90": "accent3",
  "1e171933-4619-4e11-9a3f-f7608df75f80": "accent4",
  "fabfcf23-3b69-468f-b69f-88f6de6a72f2": "accent5",
  "10a1b5d5-9b99-4c35-a422-299274c87663": "accent6",
};

function line(edge: string, color: string) {
  return `<a:${edge}><a:ln w="12700" cmpd="sng"><a:solidFill><a:schemeClr val="${color}"/></a:solidFill></a:ln></a:${edge}>`;
}

/**
 * Medium Style 2 when the package names the style but omits its body.
 * Accent variants replace dk1 with that accent, per MS-OE376.
 */
const mediumStyle2Color: Record<string, string> = {
  "073a0daa-6af3-43ab-8588-cec1d06c72b9": "dk1",
  "5c22544a-7ee6-4342-b048-85bdc9fd1c3a": "accent1",
  "21e4aea4-8dfa-4a89-87eb-49c32662afe0": "accent2",
  "f5ab1c69-6edb-4ff4-983f-18bd219ef322": "accent3",
  "00a15c55-8517-42aa-b614-e9b94910e393": "accent4",
  "7df18680-e054-41ad-8bc1-d1aef772440d": "accent5",
  "93296810-a885-4be3-a3e7-6d5beea58f35": "accent6",
};

function whiteEdge(edge: string, width = 12700) {
  return `<a:${edge}><a:ln w="${width}" cmpd="sng"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:${edge}>`;
}

/** Medium Style 2 Accent 1: solid header and first column, tinted bands. */
export function mediumStyle2(id: string): string | undefined {
  const color = mediumStyle2Color[id.replace(/[{}]/g, "").toLowerCase()];
  if (!color) return;
  const solid = `<a:solidFill><a:schemeClr val="${color}"/></a:solidFill>`;
  const tint = (value: number) =>
    `<a:solidFill><a:schemeClr val="${color}"><a:tint val="${value}"/></a:schemeClr></a:solidFill>`;
  const accentText = `<a:tcTxStyle b="on"><a:schemeClr val="lt1"/></a:tcTxStyle>`;
  return `<a:tblStyle styleId="${id}" styleName="Medium Style 2">
    <a:wholeTbl><a:tcTxStyle><a:schemeClr val="dk1"/></a:tcTxStyle>
      <a:tcStyle><a:tcBdr>${whiteEdge("left")}${whiteEdge("right")}${whiteEdge("top")}${whiteEdge("bottom")}${whiteEdge("insideH")}${whiteEdge("insideV")}</a:tcBdr>
      <a:fill>${tint(20000)}</a:fill></a:tcStyle></a:wholeTbl>
    <a:band1H><a:tcStyle><a:fill>${tint(40000)}</a:fill></a:tcStyle></a:band1H>
    <a:band2H><a:tcStyle><a:tcBdr/></a:tcStyle></a:band2H>
    <a:band1V><a:tcStyle><a:fill>${tint(40000)}</a:fill></a:tcStyle></a:band1V>
    <a:band2V><a:tcStyle><a:tcBdr/></a:tcStyle></a:band2V>
    <a:firstCol>${accentText}<a:tcStyle><a:fill>${solid}</a:fill></a:tcStyle></a:firstCol>
    <a:lastCol>${accentText}<a:tcStyle><a:fill>${solid}</a:fill></a:tcStyle></a:lastCol>
    <a:firstRow>${accentText}<a:tcStyle><a:tcBdr>${whiteEdge("bottom", 38100)}</a:tcBdr><a:fill>${solid}</a:fill></a:tcStyle></a:firstRow>
    <a:lastRow>${accentText}<a:tcStyle><a:tcBdr>${whiteEdge("top", 38100)}</a:tcBdr><a:fill>${solid}</a:fill></a:tcStyle></a:lastRow>
  </a:tblStyle>`;
}

/** Medium Style 1 and its six accent colours, as DrawingML. */
export function mediumTableStyle(id: string): string | undefined {
  const color = mediumStyle1Color[id.replace(/[{}]/g, "").toLowerCase()];
  if (!color) return;
  const tinted = `<a:solidFill><a:schemeClr val="${color}"><a:tint val="20000"/></a:schemeClr></a:solidFill>`;
  return `<a:tblStyle styleId="${id}" styleName="Medium Style 1">
    <a:wholeTbl><a:tcTxStyle><a:schemeClr val="dk1"/></a:tcTxStyle>
      <a:tcStyle><a:tcBdr>${line("left", color)}${line("right", color)}${line("top", color)}${line("bottom", color)}${line("insideH", color)}</a:tcBdr>
      <a:fill><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:fill></a:tcStyle></a:wholeTbl>
    <a:band1H><a:tcStyle><a:fill>${tinted}</a:fill></a:tcStyle></a:band1H>
    <a:band1V><a:tcStyle><a:fill>${tinted}</a:fill></a:tcStyle></a:band1V>
    <a:firstRow><a:tcTxStyle><a:schemeClr val="lt1"/></a:tcTxStyle>
      <a:tcStyle><a:fill><a:solidFill><a:schemeClr val="${color}"/></a:solidFill></a:fill></a:tcStyle></a:firstRow>
    <a:lastRow><a:tcStyle><a:tcBdr>${line("top", color)}</a:tcBdr>
      <a:fill><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:fill></a:tcStyle></a:lastRow>
  </a:tblStyle>`;
}
