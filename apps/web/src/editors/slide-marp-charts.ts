import { parse } from "acorn";

type Syntax = Record<string, unknown>;
export type ChartDefinition = {
  target: string;
  config: Record<string, unknown>;
  themed: boolean;
};
const node = (value: unknown): Syntax =>
  value && typeof value === "object" ? (value as Syntax) : {};
const identifier = (value: unknown, name: string) =>
  node(value).type === "Identifier" && node(value).name === name;

function literal(value: unknown, depth = 0): unknown {
  const ast = node(value);
  if (depth > 30) throw new Error("Chart configuration is too deeply nested.");
  if (
    ast.type === "Literal" &&
    (ast.value === null ||
      ["string", "number", "boolean"].includes(typeof ast.value))
  )
    return ast.value;
  if (
    ast.type === "UnaryExpression" &&
    (ast.operator === "-" || ast.operator === "+")
  ) {
    const arg = literal(ast.argument, depth + 1);
    if (typeof arg === "number") return ast.operator === "-" ? -arg : arg;
  }
  if (ast.type === "ArrayExpression")
    return (ast.elements as unknown[]).map((item) => literal(item, depth + 1));
  if (ast.type === "ObjectExpression") {
    const result: Record<string, unknown> = {};
    for (const item of ast.properties as unknown[]) {
      const property = node(item),
        key = node(property.key);
      if (
        property.type !== "Property" ||
        property.computed ||
        property.method ||
        property.kind !== "init"
      )
        throw new Error(
          "Chart configuration must contain data, not executable code.",
        );
      const name = key.type === "Identifier" ? key.name : key.value;
      if (
        typeof name !== "string" ||
        ["__proto__", "prototype", "constructor"].includes(name)
      )
        throw new Error("Invalid chart property.");
      result[name] = literal(property.value, depth + 1);
    }
    return result;
  }
  throw new Error("Chart configuration must contain literal data.");
}
function canvasId(value: unknown): string | null {
  const ast = node(value),
    callee = node(ast.callee);
  if (
    ast.type !== "CallExpression" ||
    callee.type !== "MemberExpression" ||
    !identifier(callee.object, "document") ||
    !identifier(callee.property, "getElementById")
  )
    return null;
  const id = literal((ast.arguments as unknown[])[0]);
  return typeof id === "string" ? id : null;
}

/** Read literal Chart.js configurations without evaluating any source-authored JavaScript. */
export function extractMarpCharts(
  scripts: string[],
  themed = false,
): ChartDefinition[] {
  const charts: ChartDefinition[] = [];
  const visit = (value: unknown) => {
    const ast = node(value),
      callee = node(ast.callee),
      args = ast.arguments as unknown[] | undefined;
    if (
      ast.type === "NewExpression" &&
      identifier(ast.callee, "Chart") &&
      args
    ) {
      const target = canvasId(args[0]),
        config = node(literal(args[1]));
      if (target && typeof config.type === "string")
        charts.push({ target, config, themed });
    } else if (
      ast.type === "CallExpression" &&
      callee.type === "MemberExpression" &&
      identifier(callee.object, "CDLChart") &&
      args
    ) {
      const method = node(callee.property).name;
      if (["bar", "line", "pie", "doughnut"].includes(String(method))) {
        const target = literal(args[0]),
          labels = literal(args[1]),
          data = literal(args[2]);
        if (
          typeof target === "string" &&
          Array.isArray(labels) &&
          Array.isArray(data)
        ) {
          const userOptions = args[3] ? node(literal(args[3])) : {};
          const options =
            method === "bar"
              ? { plugins: { legend: { display: false } }, ...userOptions }
              : userOptions;
          const datasets =
            method === "line"
              ? data.map((item) => {
                  const dataset = node(item);
                  return {
                    label: dataset.label,
                    data: dataset.data,
                    fill: dataset.fill ?? true,
                  };
                })
              : [{ data }];
          charts.push({
            target,
            config: {
              type: method,
              data: { labels, datasets },
              options,
            },
            themed: true,
          });
        }
      }
    }
    for (const child of Object.values(ast)) {
      if (Array.isArray(child))
        child.forEach((item) => {
          if (node(item).type) visit(item);
        });
      else if (node(child).type) visit(child);
    }
  };
  for (const source of scripts) {
    if (!/(?:new\s+Chart|CDLChart\s*\.)/.test(source)) continue;
    visit(parse(source, { ecmaVersion: "latest" }));
  }
  return charts;
}
