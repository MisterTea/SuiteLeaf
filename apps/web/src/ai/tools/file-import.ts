import { ToolError } from "../host";
import { moveCursor } from "../cursor";
import { wait } from "./file-tool-kit";

export const IMPORT_ACCEPT =
  ".sldoc,.slsheet,.slslides,.sldraw,.suiteleaf,.svg,.mmd,.mermaid,.gv,.docx,.docm,.dotx,.dotm,.doc,.dot,.xlsx,.xlsm,.xlsb,.xltx,.xls,.pptx,.ppt,.ppsx,.pptm,.potx,.ppsm,.odt,.ott,.fodt,.ods,.fods,.odp,.fodp,.rtf,.md,.markdown,.html,.htm,.txt,.csv,.tsv";

const SEPARATORS: Record<string, string> = { comma: ",", semicolon: ";", tab: "\t", pipe: "|" };

/** Answers a CSV/TSV import preview with the agent's choices, as a person would, and says what it showed. */
export async function answerImportPreview(
  dialog: HTMLElement,
  name: string,
  choices: { keep_codes_as_text?: boolean; first_row_is_header?: boolean; separator?: string },
) {
  const box = (text: string) =>
    [...dialog.querySelectorAll("label.checkbox-row")]
      .find((l) => l.textContent?.includes(text))
      ?.querySelector<HTMLInputElement>("input");
  const setBox = async (text: string, want: boolean | undefined) => {
    const input = box(text);
    if (!input || want === undefined) return;
    await moveCursor(input, text);
    if (input.checked !== want) input.click();
    await wait(500);
  };
  await wait(300);
  await moveCursor(dialog.querySelector('[role="status"]'), "Import preview");
  await wait(500);
  const separator = SEPARATORS[choices.separator ?? ""];
  const select = dialog.querySelector("select");
  if (separator && select && select.value !== separator) {
    await moveCursor(select, "Separator");
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, separator);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(500);
  }
  await setBox("First row is a header", choices.first_row_is_header);
  await setBox("Keep code columns as text", choices.keep_codes_as_text ?? true);
  const summary = dialog.querySelector('[role="status"]')?.textContent?.trim() ?? "";
  const columns = [...dialog.querySelectorAll("thead th")].map(
    (th) => `${th.querySelector("span")?.textContent ?? ""} (${th.querySelector("small")?.textContent ?? ""})`,
  );
  const codes = box("Keep code columns as text");
  const codeNote = codes
    ? codes.checked
      ? ` ${codes.parentElement?.querySelector("small")?.textContent?.trim()}`
      : " Code columns with leading zeros were not kept as text."
    : "";
  const notes = [...dialog.querySelectorAll(".csv-import-note")].map((n) => ` ${n.textContent?.trim()}`).join("");
  const error = dialog.querySelector('[role="alert"]')?.textContent?.trim();
  const buttons = [...dialog.querySelectorAll("button")];
  if (error) {
    buttons.find((b) => b.textContent?.trim() === "Cancel")?.click();
    throw new ToolError(`The import preview of "${name}" says: ${error} (${summary}). It was not imported.`);
  }
  const ok = buttons.find((b) => b.textContent?.trim() === "Import");
  await moveCursor(ok, "Import");
  ok?.click();
  return `Imported "${name}" from its preview: ${summary}. Columns: ${columns.join(", ")}.${codeNote}${notes}`;
}
