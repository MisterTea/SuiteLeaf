import { FontCache, UniverRenderingContext2D } from "@univerjs/engine-render";

/**
 * Excel never kerns cell text. Univer measures and paints plain cells with the
 * canvas default, "auto", which does. A style that sets kerning still wins.
 */
let installed = false;

export function stopSheetKerning(): void {
  if (installed) return;
  installed = true;
  const measure = FontCache.getMeasureText.bind(FontCache);
  FontCache.getMeasureText = (content, fontString, kerning = "none") =>
    measure(content, fontString, kerning === "auto" ? "none" : kerning);
  const proto = UniverRenderingContext2D.prototype;
  for (const name of ["fillText", "fillTextPrecision", "strokeText", "measureText"] as const) {
    const original = proto[name] as (...args: unknown[]) => unknown;
    Object.defineProperty(proto, name, {
      configurable: true,
      writable: true,
      value(this: UniverRenderingContext2D, ...args: unknown[]) {
        if (this.fontKerning === "auto") this.fontKerning = "none";
        return original.apply(this, args);
      },
    });
  }
}
