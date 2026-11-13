import { expect, type Locator } from "@playwright/test";

/** Enter the real slide text editor; inactive boxes are rendered content, not inputs. */
export async function editSlideText(box: Locator): Promise<Locator> {
  await box.click();
  await expect(box).toHaveClass(/selected/);
  await box.locator(".element-textarea").first().dblclick();
  const editor = box.locator('.element-editor[contenteditable="true"]');
  await expect(editor).toBeFocused();
  return editor;
}

export async function fillSlideText(box: Locator, text: string): Promise<void> {
  const editor = await editSlideText(box);
  await editor.fill(text);
  await editor.blur();
}
