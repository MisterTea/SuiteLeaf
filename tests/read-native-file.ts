import { readFile } from "node:fs/promises";
import { parseFileBytes } from "../packages/core/src";

/**
 * Read a SuiteLeaf native file from disk. Docs, sheets, and slides may be a
 * v2 sectioned ZIP package or legacy UTF-8 JSON; this uses the same
 * `parseFileBytes` helper as the app. The return type is deliberately loose
 * so existing test assertions (previously `JSON.parse`) type-check unchanged.
 */
export async function readNativeFile(path: string): Promise<any> {
  return parseFileBytes(await readFile(path));
}
