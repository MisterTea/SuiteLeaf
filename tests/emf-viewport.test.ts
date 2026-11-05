import { expect, it } from "vitest";
import { emfViewport } from "../packages/core/src/emf-viewport";

function header() {
 const bytes = new Uint8Array(108), view = new DataView(bytes.buffer);
 for (const [at, value] of [[0,1],[40,0x464d4520],[8,-16],[12,-16],[16,207],[20,102],[32,19200],[36,8600],[72,100],[76,100],[80,100],[84,100]]) view.setInt32(at,value,true);
 return bytes;
}
it("uses device bounds for standalone files but physical frames for embedded images", () => {
 expect(emfViewport(header())).toEqual({originX:-16,originY:-16,width:224,height:119});
 expect(emfViewport(header(),true)).toEqual({originX:0,originY:0,width:192,height:86});
});
it("rejects invalid files and retains bounds when physical dimensions are absent", () => {
 expect(emfViewport(new Uint8Array())).toBeUndefined();
 const bytes=header(), view=new DataView(bytes.buffer);
 view.setInt32(72,0,true);
 expect(emfViewport(bytes,true)?.width).toBe(224);
 view.setInt32(16,-17,true);
 expect(emfViewport(bytes)).toBeUndefined();
 view.setInt32(0,0,true);
 expect(emfViewport(bytes)).toBeUndefined();
});
