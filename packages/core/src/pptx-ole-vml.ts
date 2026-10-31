/** One OLE preview stored in the slide's VML drawing, keyed by `o:spid`. */
export type VmlOlePreview = { spid: string; relId: string };

/**
 * PowerPoint keeps the printable picture of an embedded OLE object in the
 * VML drawing, not in the graphic frame. `o:relid` is a relationship of that
 * VML part.
 */
export function vmlOleImageRels(vmlXml: string): VmlOlePreview[] {
  const found: VmlOlePreview[] = [];
  for (const match of vmlXml.matchAll(/<v:shape\b[\s\S]*?<\/v:shape>/g)) {
    const shape = match[0];
    const spid = /o:spid="([^"]+)"/.exec(shape)?.[1];
    const relId = /<v:imagedata\b[^>]*\bo:relid="([^"]+)"/.exec(shape)?.[1];
    if (spid && relId) found.push({ spid, relId });
  }
  return found;
}
