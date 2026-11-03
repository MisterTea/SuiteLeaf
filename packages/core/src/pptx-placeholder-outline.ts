/**
 * A slide placeholder often stores only its position. The outline stays on
 * the layout or master shape until the slide writes its own `a:ln`.
 */
function shapeProperties(xml: string) {
  return (
    /<p:spPr\b[^>]*\/>/.exec(xml)?.[0] ||
    /<p:spPr\b[\s\S]*?<\/p:spPr>/.exec(xml)?.[0] ||
    ""
  );
}

function outlineNode(xml: string) {
  return /<a:ln\b[^>]*\/>|<a:ln\b[\s\S]*?<\/a:ln>/.exec(shapeProperties(xml))?.[0];
}

/** The slide chose a stroke, including an explicit `noFill` that hides the master line. */
function outlineIsSet(xml: string) {
  const line = outlineNode(xml);
  if (!line) return false;
  return (
    /\bw="\d+"/.test(line) ||
    /<a:(?:noFill|solidFill|gradFill|pattFill)\b/.test(line)
  );
}

function paintableOutline(xml: string) {
  const line = outlineNode(xml);
  if (!line || /<a:noFill\b/.test(line)) return;
  if (!/<a:(?:solidFill|gradFill|pattFill)\b/.test(line)) return;
  return line;
}

function spliceOutline(shapeXml: string, line: string) {
  return spliceNode(shapeXml, line);
}

function geometryNode(xml: string) {
  const sp = shapeProperties(xml);
  return (
    /<a:custGeom\b[\s\S]*?<\/a:custGeom>/.exec(sp)?.[0] ||
    /<a:prstGeom\b[\s\S]*?<\/a:prstGeom>/.exec(sp)?.[0] ||
    /<a:prstGeom\b[^>]*\/>/.exec(sp)?.[0]
  );
}

function spliceNode(shapeXml: string, node: string) {
  if (/<p:spPr\b[^>]*\/>/.test(shapeXml))
    return shapeXml.replace(/<p:spPr\b[^>]*\/>/, `<p:spPr>${node}</p:spPr>`);
  if (/<p:spPr\b/.test(shapeXml))
    return shapeXml.replace(/<p:spPr\b([^>]*)>/, `<p:spPr$1>${node}`);
  return `<p:spPr>${node}</p:spPr>${shapeXml}`;
}

/**
 * A placeholder that stores only its box inherits the layout or master
 * geometry. PowerPoint does not replace a missing path with a rectangle.
 */
export function withInheritedGeometry(
  shapeXml: string,
  layoutXml: string,
  masterXml: string,
) {
  if (geometryNode(shapeXml)) return shapeXml;
  const geom = [layoutXml, masterXml].map(geometryNode).find(Boolean);
  return geom ? spliceNode(shapeXml, geom) : shapeXml;
}

/** Copy the nearest placeholder outline when this shape did not set one. */
export function withInheritedOutline(
  shapeXml: string,
  layoutXml: string,
  masterXml: string,
) {
  if (outlineIsSet(shapeXml)) return shapeXml;
  const line = [layoutXml, masterXml].map(paintableOutline).find(Boolean);
  return line ? spliceOutline(shapeXml, line) : shapeXml;
}
