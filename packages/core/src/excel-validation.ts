/** Excel's errorStyle names, and Univer's numeric DataValidationErrorStyle. */
const styles: Record<string, number> = {
  stop: 1,
  "1": 1,
  warning: 2,
  "2": 2,
  information: 0,
  info: 0,
  "0": 0,
};

/** Univer stores 0 | 1 | 2. Excel stores stop | warning | information. */
export function univerErrorStyle(style: unknown): number | undefined {
  const mapped = styles[String(style ?? "").trim().toLowerCase()];
  return mapped === undefined ? undefined : mapped;
}

export function excelErrorStyle(style: unknown): string {
  const mapped = univerErrorStyle(style);
  if (mapped === 1) return "stop";
  if (mapped === 2) return "warning";
  if (mapped === 0) return "information";
  const text = String(style ?? "").trim();
  return text || "stop";
}
