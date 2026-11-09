import katex from "katex";
import { XMLParser } from "fast-xml-parser";

type Tree = {
  tag: string;
  text: string;
  children: Tree[];
  attrs: Record<string, string>;
};
const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  trimValues: false,
  parseTagValue: false,
});
const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
function tree(xml: string): Tree[] {
  function read(nodes: Record<string, unknown>[]): Tree[] {
    return nodes.flatMap((node) =>
      Object.entries(node).flatMap(([key, value]) => {
        if (!Array.isArray(value)) return [];
        return [
          {
            tag: key.replace(/^.*:/, ""),
            text: value.map((item) => item["#text"] ?? "").join(""),
            children: read(value),
            attrs: (node[":@"] ?? {}) as Record<string, string>,
          },
        ];
      }),
    );
  }
  return read(parser.parse(xml));
}

export function unwrapSlideLatex(source: string): string {
  const input = source.trim();
  const delimiters = [
    ["$$", "$$"],
    ["\\[", "\\]"],
    ["\\(", "\\)"],
    ["$", "$"],
  ];
  const pair = delimiters.find(
    ([open, close]) => input.startsWith(open) && input.endsWith(close),
  );
  return pair ? input.slice(pair[0].length, -pair[1].length).trim() : input;
}

export function latexMathML(source: string): string {
  if (!source.trim() || source.length > 4096)
    throw new Error("Enter a LaTeX equation of up to 4,096 characters.");
  const body = unwrapSlideLatex(source);
  if (!body) throw new Error("Enter a LaTeX equation.");
  return katex.renderToString(body, {
    output: "mathml",
    displayMode: true,
    throwOnError: true,
    trust: false,
    maxExpand: 200,
    maxSize: 20,
  });
}

export function latexOfficeMath(
  source: string,
  fontSize?: number,
  color?: string,
): string {
  const size =
    fontSize && Number.isFinite(fontSize) && fontSize > 0
      ? ` sz="${Math.round(fontSize * 100)}"`
      : "";
  const rgb = /^#?([0-9a-f]{6})$/i.exec(color ?? "")?.[1];
  const paint = rgb
    ? `<a:solidFill><a:srgbClr val="${rgb.toUpperCase()}"/></a:solidFill>`
    : "";
  const style = size || paint ? `<a:rPr${size}>${paint}</a:rPr>` : "";
  const run = (s: string) =>
    `<m:r>${style}<m:t xml:space="preserve">${escape(s)}</m:t></m:r>`;
  const wrap = (tag: string, inner: string) => `<m:${tag}>${inner}</m:${tag}>`;
  function encode(n: Tree): string {
    const c = (i: number) => (n.children[i] ? encode(n.children[i]) : "");
    switch (n.tag) {
      case "annotation":
        return "";
      case "mi":
      case "mn":
      case "mo":
      case "mtext":
        return n.children.length
          ? n.children.map(encode).join("")
          : run(n.text);
      case "mspace":
        return run(" ");
      case "mfrac":
        return wrap(
          "f",
          (/^0(?:px|pt|em)?$/.test(n.attrs["@_linethickness"] ?? "")
            ? '<m:fPr><m:type m:val="noBar"/></m:fPr>'
            : "") +
            wrap("num", c(0)) +
            wrap("den", c(1)),
        );
      case "msup":
        return wrap("sSup", wrap("e", c(0)) + wrap("sup", c(1)));
      case "msub":
        return wrap("sSub", wrap("e", c(0)) + wrap("sub", c(1)));
      case "msubsup":
        return wrap(
          "sSubSup",
          wrap("e", c(0)) + wrap("sub", c(1)) + wrap("sup", c(2)),
        );
      case "msqrt":
        return wrap(
          "rad",
          '<m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>' +
            wrap("e", n.children.map(encode).join("")),
        );
      case "mroot":
        return wrap("rad", wrap("deg", c(1)) + wrap("e", c(0)));
      case "munder":
        return wrap("limLow", wrap("e", c(0)) + wrap("lim", c(1)));
      case "mover": {
        const accent = n.children[1]?.text;
        if (accent && n.attrs["@_accent"] === "true")
          return wrap(
            "acc",
            `<m:accPr><m:chr m:val="${escape(accent)}"/></m:accPr>` +
              wrap("e", c(0)),
          );
        return wrap("limUpp", wrap("e", c(0)) + wrap("lim", c(1)));
      }
      case "munderover":
        return wrap(
          "limUpp",
          wrap("e", wrap("limLow", wrap("e", c(0)) + wrap("lim", c(1)))) +
            wrap("lim", c(2)),
        );
      case "mtable":
        return wrap(
          "m",
          n.children
            .map((r) =>
              wrap(
                "mr",
                r.children.map((cell) => wrap("e", encode(cell))).join(""),
              ),
            )
            .join(""),
        );
      default:
        return n.children.map(encode).join("") || (n.text ? run(n.text) : "");
    }
  }
  return `<a14:m xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><m:oMath>${tree(latexMathML(source)).map(encode).join("")}</m:oMath></a14:m>`;
}

export function officeMathLatex(xml: string): string {
  function decode(n: Tree): string {
    const child = (name: string) =>
      n.children
        .filter((c) => c.tag === name)
        .map(decode)
        .join("");
    const e = () => child("e");
    switch (n.tag) {
      case "t":
        return n.text.replace(/[{}_%#$&]/g, (c) => "\\" + c);
      case "f":
        return "\\frac{" + child("num") + "}{" + child("den") + "}";
      case "sSup":
        return "{" + e() + "}^{" + child("sup") + "}";
      case "sSub":
        return "{" + e() + "}_{" + child("sub") + "}";
      case "sSubSup":
        return "{" + e() + "}_{" + child("sub") + "}^{" + child("sup") + "}";
      case "rad":
        return (
          "\\sqrt" +
          (child("deg") ? "[" + child("deg") + "]" : "") +
          "{" +
          e() +
          "}"
        );
      case "limLow":
        return "\\underset{" + child("lim") + "}{" + e() + "}";
      case "limUpp":
        return "\\overset{" + child("lim") + "}{" + e() + "}";
      case "acc": {
        const accent = n.children
          .find((c) => c.tag === "accPr")
          ?.children.find((c) => c.tag === "chr")?.attrs["@_m:val"];
        const command = (
          {
            "^": "hat",
            "\u0302": "hat",
            "¯": "bar",
            "\u0305": "bar",
            "~": "tilde",
            "\u0303": "tilde",
            "→": "vec",
          } as Record<string, string>
        )[accent ?? ""];
        return command
          ? "\\" + command + "{" + e() + "}"
          : "\\overset{" + (accent ?? "") + "}{" + e() + "}";
      }
      case "nary": {
        const sign = n.children
          .find((c) => c.tag === "naryPr")
          ?.children.find((c) => c.tag === "chr")?.attrs["@_m:val"];
        return (
          (sign === "∫" ? "\\int" : sign === "∏" ? "\\prod" : sign || "\\sum") +
          "_{" +
          child("sub") +
          "}^{" +
          child("sup") +
          "}" +
          e()
        );
      }
      case "m":
        return n.children.some((c) => c.tag === "mr")
          ? "\\begin{matrix}" +
              n.children
                .filter((c) => c.tag === "mr")
                .map((r) => r.children.map(decode).join("&"))
                .join("\\\\") +
              "\\end{matrix}"
          : n.children.map(decode).join("");
      default:
        return n.tag.endsWith("Pr") ? "" : n.children.map(decode).join("");
    }
  }
  return tree(xml).map(decode).join("");
}
