/** Editor components and model downloads for one signed release. */

export type NoticeComponent = { name: string; version: string; license: string };
export type ModelDownload = { name: string; sha256: string };

export type ReleaseNotice = {
  product: "suiteleaf";
  version: string;
  installerSha256: string;
  signature: "matched" | "rejected";
  schemaVersion: number;
  editor: NoticeComponent[];
  models: ModelDownload[];
  text: string;
};

export function releaseNotice(input: {
  version: string;
  installerSha256: string;
  signatureMatched: boolean;
  schemaVersion: number;
  editor: NoticeComponent[];
  models: ModelDownload[];
}): ReleaseNotice {
  const editor = [...input.editor].sort((a, b) => a.name.localeCompare(b.name, "en"));
  const seen = new Set<string>();
  for (const component of editor) {
    if (seen.has(component.name)) throw new Error("An editor component is listed twice.");
    seen.add(component.name);
  }
  const models = [...input.models].sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const model of models) {
    if (seen.has(model.name)) throw new Error("A model download is not an editor component.");
  }
  const signature = input.signatureMatched ? "matched" : "rejected";
  const editorLines = editor.map(
    (component) => `${component.name} ${component.version} ${component.license}`,
  );
  const modelLines = models.map(
    (model) => `${model.name} ${model.sha256} is not part of the editor update`,
  );
  const text = [
    `SuiteLeaf ${input.version}`,
    `installer ${input.installerSha256}`,
    `signature ${signature}`,
    `schema ${input.schemaVersion}`,
    "editor",
    ...editorLines,
    "models",
    ...modelLines,
  ].join("\n");
  return {
    product: "suiteleaf",
    version: input.version,
    installerSha256: input.installerSha256,
    signature,
    schemaVersion: input.schemaVersion,
    editor,
    models,
    text,
  };
}
