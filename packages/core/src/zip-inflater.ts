import pako from "pako";
const { Inflate, deflateRaw } = pako;
/** SheetJS's built-in inflater can hang on valid DEFLATE streams. Its public CFB
 * adapter accepts zlib-compatible inflaters; Pako provides the same browser-safe
 * stream and consumed-byte accounting used by ZIP readers. */
export class OfficeInflateRaw {
  bytesRead = 0;
  _finishFlushFlag = 4;
  _processChunk(input: Uint8Array): Uint8Array {
    const stream = new Inflate({ raw: true });
    stream.push(input, true);
    if (stream.err) throw new Error(stream.msg || "Invalid DEFLATE stream.");
    this.bytesRead = (stream as any).strm.total_in;
    return stream.result as Uint8Array;
  }
}
export const officeZlib = {
  InflateRaw: OfficeInflateRaw,
  deflateRawSync: deflateRaw,
};
