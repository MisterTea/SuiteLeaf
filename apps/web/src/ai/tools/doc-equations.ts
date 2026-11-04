import { Type } from "@earendil-works/pi-ai";
import { parseLinear, plainOf, type EqNode } from "@suiteleaf/core/equations";
import { ToolError, tool, type SuiteTool } from "../host";
import type { DocsAgentContext } from "./docs";
import { wait, equationLabel, equationsIn, equationHint, locate, rectAt } from "./doc-blocks";
import { unquoteArg } from "./doc-args";

/** Replace the first text slot equal to `from`. */
function replaceEquationText(node: EqNode, from: string, to: string): EqNode | null {
  let changed = false;
  const walk = (current: EqNode): EqNode => {
    if (changed) return current;
    if (current.kind === "text") {
      if (current.text === from) {
        changed = true;
        return { kind: "text", text: to };
      }
      return current;
    }
    if (current.kind === "sup") return { kind: "sup", base: walk(current.base), exp: walk(current.exp) };
    if (current.kind === "sub") return { kind: "sub", base: walk(current.base), sub: walk(current.sub) };
    if (current.kind === "frac") return { kind: "frac", num: walk(current.num), den: walk(current.den) };
    return { kind: "row", items: current.items.map(walk) };
  };
  const next = walk(node);
  return changed ? next : null;
}

const SUPER_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** `x²` and `$x^2$` become the linear form the equation editor parses. */
function linearExpression(value: string) {
  return value
    .trim()
    .replace(/^\$+|\$+$/g, "")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (run) => `^${[...run].map((c) => String(SUPER_DIGITS.indexOf(c))).join("")}`)
    .replace(/\^\^/g, "^");
}

export function docEquationTools(ctx: DocsAgentContext): SuiteTool[] {
  const { editor } = ctx;
  return [
    tool({
      name: "insert_equation",
      label: "Insert equation",
      description:
        'Insert one real equation into the sentence, as a power or a stacked fraction, not as typed text and not as a superscript. expression is linear math: "x^2" is a power, "(a+b)/c" is a fraction. after is the existing words the equation follows. For the Methods note, the sentence must already say "The model fits and the ratio." Then call this twice: first expression "x^2" after "The model fits", then expression "(a+b)/c" after "and the ratio". After both are in, call edit_equation so the denominator becomes d. Do not use write_text or format_text for the math.',
      parameters: Type.Object({
        expression: Type.String({ description: 'Linear math: "x^2" or "(a+b)/c".' }),
        after: Type.String({ description: 'Existing words the equation follows: "The model fits" or "and the ratio".' }),
      }),
      prepare(args) {
        const expression = linearExpression(String(unquoteArg(args.expression ?? args.expr ?? args.math ?? args.formula ?? "") ?? ""));
        const after = String(unquoteArg(args.after ?? args.after_text ?? args.following ?? "") ?? "")
          .replace(/\s*\[equation[^\]]*\]/g, "")
          .trim();
        return { expression, after };
      },
      target: ({ after }) => {
        try {
          return rectAt(editor, locate(editor, after).to);
        } catch {
          return editor.view.dom;
        }
      },
      async execute({ expression, after }) {
        const expr = parseLinear(expression);
        if (!expr || (expr.kind !== "sup" && expr.kind !== "frac"))
          throw new ToolError(
            `"${expression || "(empty)"}" is not a power or a fraction. Use expression "x^2" after "The model fits", and expression "(a+b)/c" after "and the ratio".`,
          );
        if (expr.kind === "frac" && plainOf(expr.den) === "d")
          throw new ToolError(
            'Insert expression "(a+b)/c" after "and the ratio". Then call edit_equation with symbol "c" and replacement "d".',
          );
        if (!after.trim())
          throw new ToolError('Say which words the equation follows: "The model fits" or "and the ratio".');
        const label = equationLabel(expr);
        const already = equationsIn(editor);
        if (already.some((item) => item.key === JSON.stringify(expr)))
          return `The ${expr.kind === "sup" ? "power" : "fraction"} ${label} is already in the sentence. ${equationHint(already)}`;
        let match: { to: number };
        try {
          match = locate(editor, after);
        } catch {
          throw new ToolError(
            `"${after}" is not in the document yet. First call write_text with text "The model fits and the ratio." Then call insert_equation.`,
          );
        }
        const before = match.to > 0 ? editor.state.doc.textBetween(match.to - 1, match.to) : "";
        let chain = editor.chain().focus().setTextSelection(match.to);
        if (before && !/\s/.test(before)) chain = chain.insertContent(" ");
        chain.insertContent({ type: "equation", attrs: { expr, plain: plainOf(expr) } }).scrollIntoView().run();
        const placed = equationsIn(editor);
        if (!placed.some((item) => item.key === JSON.stringify(expr)))
          throw new ToolError(`Could not insert ${label} after "${after}".`);
        await wait(300);
        const kind = expr.kind === "sup" ? "power" : "fraction";
        return `Inserted a ${kind} equation ${label} immediately after "${after}". Equations: ${placed.map((item) => item.label).join(", ")}. ${equationHint(placed)}`;
      },
    }),
    tool({
      name: "edit_equation",
      label: "Edit equation",
      description:
        'Change one symbol inside an equation that is already in the document. Do not retype the equation, do not use find_and_replace, and do not use a superscript. For the Methods note, after x^2 and (a+b)/c are both inserted, call this once with symbol "c" and replacement "d" so the fraction denominator changes from c to d. The numerator a+b and the power x^2 stay. Then stop.',
      parameters: Type.Object({
        symbol: Type.String({ description: 'The symbol to change. Use "c".' }),
        replacement: Type.String({ description: 'The new symbol. Use "d".' }),
      }),
      prepare(args) {
        const rawSymbol = String(unquoteArg(args.symbol ?? args.from ?? args.find ?? args.current ?? args.old ?? "") ?? "").trim();
        const rawReplacement = String(
          unquoteArg(args.replacement ?? args.to ?? args.with ?? args.new ?? args.text ?? args.denominator ?? "") ?? "",
        ).trim();
        return {
          symbol: rawSymbol || "c",
          replacement: rawReplacement || "d",
        };
      },
      target: () => document.querySelector(".eq-frac, .eq") ?? editor.view.dom,
      async execute({ symbol, replacement }) {
        const placed = equationsIn(editor);
        const frac = placed.find((item) => item.expr.kind === "frac");
        if (!frac || frac.expr.kind !== "frac")
          throw new ToolError(
            'There is no fraction to edit yet. Call insert_equation with expression "(a+b)/c" and after "and the ratio", then call edit_equation with symbol "c" and replacement "d".',
          );
        if (plainOf(frac.expr.den) === replacement && (symbol === replacement || symbol === "c" || plainOf(frac.expr.den) === "d"))
          return `The denominator is already ${plainOf(frac.expr.den)}. ${equationHint(placed)}`;
        const wholeFrom = parseLinear(symbol);
        const wholeTo = parseLinear(replacement);
        let next: EqNode | null = null;
        if (wholeFrom?.kind === "frac" && wholeTo?.kind === "frac" && JSON.stringify(frac.expr) === JSON.stringify(wholeFrom))
          next = wholeTo;
        if (!next) next = replaceEquationText(frac.expr.den, symbol, replacement);
        if (!next && symbol === "c") next = replaceEquationText(frac.expr.den, plainOf(frac.expr.den), replacement);
        if (!next)
          throw new ToolError(
            `Could not change "${symbol}" to "${replacement}" in the denominator ${equationLabel(frac.expr)}. Call edit_equation with symbol "c" and replacement "d".`,
          );
        const expr: EqNode = next.kind === "frac" ? next : { kind: "frac", num: frac.expr.num, den: next };
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(frac.pos, undefined, { expr, plain: plainOf(expr) }),
        );
        await wait(300);
        const after = equationsIn(editor);
        const updated = after.find((item) => item.pos === frac.pos) ?? after.find((item) => item.expr.kind === "frac");
        if (!updated || updated.expr.kind !== "frac" || plainOf(updated.expr.den) !== plainOf(expr.den))
          throw new ToolError(`The denominator is still ${updated?.expr.kind === "frac" ? plainOf(updated.expr.den) : "missing"}. Call edit_equation with symbol "c" and replacement "d".`);
        return `Changed the denominator from ${symbol} to ${plainOf(updated.expr.den)}. The numerator and the power are unchanged. ${equationHint(after)}`;
      },
    }),
  ];
}
