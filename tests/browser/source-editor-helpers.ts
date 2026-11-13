import { expect, type Locator } from "@playwright/test";
import type { Ace } from "ace-builds";

export async function sourceValue(source: Locator): Promise<string> {
  return source.evaluate(
    (node) =>
      (
        node as HTMLTextAreaElement & { __aceEditor?: Ace.Editor }
      ).__aceEditor?.getValue() ?? (node as HTMLTextAreaElement).value,
  );
}
export async function expectSourceValue(
  source: Locator,
  expected: string | RegExp,
): Promise<void> {
  if (expected instanceof RegExp)
    await expect.poll(() => sourceValue(source)).toMatch(expected);
  else await expect.poll(() => sourceValue(source)).toBe(expected);
}
export async function fillSource(source: Locator, text: string): Promise<void> {
  await source.focus();
  await source.press("ControlOrMeta+a");
  await source.page().keyboard.insertText(text);
}

export async function sourceCaret(source: Locator): Promise<number> {
  return source.evaluate(node => {
    const area = node as HTMLTextAreaElement & { __aceEditor?: Ace.Editor };
    const editor = area.__aceEditor;
    return editor ? editor.session.doc.positionToIndex(editor.getSelectionRange().start, 0) : area.selectionStart;
  });
}
