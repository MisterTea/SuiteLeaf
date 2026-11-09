import { latexMathML, textRunSchema, type TextRun } from "@suiteleaf/core";

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** OMML binary signs use medium math spacing; browser dictionaries can use thin. */
function tokens(text: string): string {
  return Array.from(text).map(char => {
    if ("+−±∓×÷∗⋅·∩∪∧∨".includes(char))
      return `<mo lspace="0.222222em" rspace="0.222222em">${escape(char)}</mo>`;
    if ("=≠≈≃≅≡≤≥<>→←↔⇒⇔".includes(char))
      return `<mo lspace="0.277778em" rspace="0.277778em">${escape(char)}</mo>`;
    if (/\s/u.test(char)) return `<mtext>${escape(char)}</mtext>`;
    return `<mi mathvariant="normal">${escape(char)}</mi>`;
  }).join("");
}

function pieces(parts: NonNullable<TextRun["fraction"]>["num"]): string {
  const out: string[] = [];
  for (const part of parts) {
    const body = `<mrow>${tokens(part.text)}</mrow>`;
    if (part.script) {
      const base = out.pop() ?? "<mrow/>";
      const tag = part.script === "sub" ? "msub" : "msup";
      out.push(`<${tag}>${base}${body}</${tag}>`);
    } else out.push(body);
  }
  return `<mrow>${out.join("")}</mrow>`;
}

/** Only generated MathML is emitted. Source XML or stored markup is never trusted. */
export function slideMathHtml(run: TextRun): string {
  const fraction = run.fraction;
  const body = fraction
    ? fraction.bar === false
      ? `<munder>${pieces(fraction.num)}${pieces(fraction.den)}</munder>`
      : `<mfrac>${pieces(fraction.num)}${pieces(fraction.den)}</mfrac>`
    : `<mrow>${tokens(run.text)}</mrow>`;
  const data = escape(JSON.stringify(run));
  if (run.latex) {
    try {
      return `<span data-slide-math="${data}" contenteditable="false">${latexMathML(run.latex)}</span>`;
    } catch { /* Display the saved text if LaTeX is invalid. */ }
  }
  return `<span data-slide-math="${data}" contenteditable="false"><math xmlns="http://www.w3.org/1998/Math/MathML" displaystyle="true" style="font-family:inherit;font-size:inherit">${body}</math></span>`;
}

/** Validate semantic data when the editable DOM is read back, including saved documents. */
export function readSlideMath(value: string): TextRun | undefined {
  try {
    const result = textRunSchema.safeParse(JSON.parse(value));
    if (result.success && result.data.math) return result.data;
  } catch { /* Malformed semantic data falls back to ordinary editable text. */ }
}
