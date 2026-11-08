import DOMPurify from "dompurify";
export function safeEmailHtml(html: string, images: boolean): string {
  const clean = DOMPurify.sanitize(html, {
    FORBID_TAGS: [
      "style",
      "form",
      "input",
      "button",
      "video",
      "audio",
      "source",
      "svg",
      "math",
      "iframe",
      "object",
      "embed",
      "link",
      "meta",
      "base",
    ],
    FORBID_ATTR: ["style", "background", "srcset", "ping", "action"],
  });
  const doc = new DOMParser().parseFromString(clean, "text/html");
  for (const image of doc.querySelectorAll("img")) {
    const src = image.getAttribute("src") || "";
    const inline =
      /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(src);
    if (!inline && (!images || !/^https:\/\//i.test(src)))
      image.removeAttribute("src");
    image.setAttribute("referrerpolicy", "no-referrer");
  }
  for (const link of doc.querySelectorAll("a")) {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  }
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${images ? "https:" : ""}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:15px/1.6 system-ui;color:#20352c;overflow-wrap:anywhere;margin:16px}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}</style></head><body>${doc.body.innerHTML}</body></html>`;
}
