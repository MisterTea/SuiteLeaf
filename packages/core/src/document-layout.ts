import type { JsonNode } from "./index";
export type PageSettings = {
  size: "letter" | "a4";
  landscape: boolean;
  margin: number;
  header: string;
  footer: string;
  pageNumbers: boolean;
};
export const defaultPageSettings: PageSettings = {
  size: "letter",
  landscape: false,
  margin: 72,
  header: "",
  footer: "",
  pageNumbers: true,
};
export function documentPageSettings(content: JsonNode): PageSettings {
  const a = content.attrs?.pageSettings as Partial<PageSettings> | undefined;
  return {
    size: a?.size === "a4" ? "a4" : "letter",
    landscape: a?.landscape === true,
    margin:
      typeof a?.margin === "number" && Number.isFinite(a.margin)
        ? Math.min(144, Math.max(24, a.margin))
        : 72,
    header: typeof a?.header === "string" ? a.header : "",
    footer: typeof a?.footer === "string" ? a.footer : "",
    pageNumbers: a?.pageNumbers !== false,
  };
}
export function pageDimensions(settings: PageSettings) {
  const [width, height] = settings.size === "a4" ? [794, 1123] : [816, 1056];
  return {
    width: settings.landscape ? height : width,
    height: settings.landscape ? width : height,
  };
}
